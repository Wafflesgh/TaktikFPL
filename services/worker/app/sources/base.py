"""Klien HTTP dasar untuk semua sumber eksternal.

Setiap request: rate-limit, retry 429/5xx (exponential backoff + jitter, maks 5 percobaan),
simpan payload ke raw_payloads, increment api_usage, dan tolak request jika kuota harian habis.
"""

import hashlib
import json
import threading
import time
from datetime import UTC, datetime
from typing import Any, Self

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.engine import Engine
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

log = structlog.get_logger()

RETRY_STATUS = {429, 500, 502, 503, 504}

# raw_payloads untuk endpoint yang sama disimpan paling sering sekali per interval ini, agar
# payload besar (bootstrap-static ±1.8 MB) tidak memenuhi kuota DB free tier. Payload error
# (status != 200) selalu disimpan.
DEFAULT_RAW_MIN_INTERVAL_MIN = 360


class QuotaExceededError(RuntimeError):
    pass


class SourceHTTPError(RuntimeError):
    def __init__(self, source: str, url: str, status: int, body: str):
        super().__init__(f"{source}: HTTP {status} untuk {url}")
        self.status = status
        self.body = body


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, SourceHTTPError):
        return exc.status in RETRY_STATUS
    return isinstance(exc, httpx.TransportError)


class RateLimiter:
    """Interval minimum antar request (thread-safe)."""

    def __init__(self, rps: float):
        self._interval = 1.0 / rps if rps > 0 else 0.0
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self._interval
        if delay > 0:
            time.sleep(delay)


class SourceClient:
    def __init__(
        self,
        name: str,
        base_url: str,
        rps: float = 1.0,
        daily_quota: int | None = None,
        engine: Engine | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
        raw_min_interval_min: int = DEFAULT_RAW_MIN_INTERVAL_MIN,
        transport: httpx.BaseTransport | None = None,
    ):
        self.name = name
        self.daily_quota = daily_quota
        self._engine = engine
        self._limiter = RateLimiter(rps)
        self._raw_min_interval = raw_min_interval_min
        self._http = httpx.Client(
            base_url=base_url,
            headers=headers or {},
            timeout=timeout,
            follow_redirects=True,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------ public
    def get_json(self, endpoint: str, params: dict[str, Any] | None = None, store_raw: bool = True) -> Any:
        """store_raw=False: payload sukses tidak disimpan (dipakai job massal per pemain agar
        raw_payloads tidak membengkak); payload error tetap disimpan."""
        self._check_quota()
        return self._get_with_retry(endpoint, params, store_raw)

    def get_text(self, endpoint: str, params: dict[str, Any] | None = None) -> str:
        """Respons non-JSON (RSS/XML). Raw disimpan terpotong 5000 karakter (dedup per interval)."""
        self._check_quota()
        return self._get_text_with_retry(endpoint, params)

    # ---------------------------------------------------------------- internal
    @retry(
        retry=retry_if_exception(_is_retryable),
        wait=wait_exponential_jitter(initial=1, max=30),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    def _get_text_with_retry(self, endpoint: str, params: dict[str, Any] | None) -> str:
        self._limiter.wait()
        resp = self._http.get(endpoint, params=params)
        self._record_usage()
        self._store_raw(endpoint, params, resp.status_code, None, resp.text)
        if resp.status_code != 200:
            log.warning("source.http_error", source=self.name, endpoint=endpoint, status=resp.status_code)
            raise SourceHTTPError(self.name, str(resp.url), resp.status_code, resp.text[:500])
        return resp.text

    @retry(
        retry=retry_if_exception(_is_retryable),
        wait=wait_exponential_jitter(initial=1, max=30),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    def _get_with_retry(self, endpoint: str, params: dict[str, Any] | None, store_raw: bool = True) -> Any:
        self._limiter.wait()
        resp = self._http.get(endpoint, params=params)
        self._record_usage()
        body: Any = None
        try:
            body = resp.json()
        except ValueError:
            body = None
        if store_raw or resp.status_code != 200:
            self._store_raw(endpoint, params, resp.status_code, body, resp.text if body is None else None)
        if resp.status_code != 200:
            log.warning("source.http_error", source=self.name, endpoint=endpoint, status=resp.status_code)
            raise SourceHTTPError(self.name, str(resp.url), resp.status_code, resp.text[:500])
        if body is None:
            # FPL menampilkan halaman HTML "The game is being updated" saat update GW.
            raise SourceHTTPError(self.name, str(resp.url), 503, resp.text[:500])
        return body

    def _check_quota(self) -> None:
        if self._engine is None or self.daily_quota is None:
            return
        with self._engine.connect() as conn:
            used = conn.execute(
                text("select requests from public.api_usage where source = :s and usage_date = :d"),
                {"s": self.name, "d": datetime.now(UTC).date()},
            ).scalar()
        if used is not None and used >= self.daily_quota:
            raise QuotaExceededError(f"{self.name}: kuota harian {self.daily_quota} habis")

    def _record_usage(self) -> None:
        if self._engine is None:
            return
        with self._engine.begin() as conn:
            conn.execute(
                text(
                    """
                    insert into public.api_usage (source, usage_date, requests, quota, updated_at)
                    values (:s, :d, 1, :q, now())
                    on conflict (source, usage_date)
                    do update set requests = public.api_usage.requests + 1,
                                  quota = excluded.quota,
                                  updated_at = now()
                    """
                ),
                {"s": self.name, "d": datetime.now(UTC).date(), "q": self.daily_quota},
            )

    def _store_raw(
        self,
        endpoint: str,
        params: dict[str, Any] | None,
        status: int,
        body: Any,
        text_body: str | None,
    ) -> None:
        if self._engine is None:
            return
        payload = body if body is not None else {"_text": (text_body or "")[:5000]}
        dumped = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        body_hash = hashlib.sha256(dumped.encode()).hexdigest()
        with self._engine.begin() as conn:
            if status == 200:
                recent = conn.execute(
                    text(
                        """
                        select body_hash from public.raw_payloads
                        where source = :s and endpoint = :e and status_code = 200
                          and fetched_at > now() - make_interval(mins => :m)
                        order by fetched_at desc limit 1
                        """
                    ),
                    {"s": self.name, "e": endpoint, "m": self._raw_min_interval},
                ).first()
                if recent is not None:
                    return
            conn.execute(
                text(
                    """
                    insert into public.raw_payloads (source, endpoint, params, status_code, body, body_hash)
                    values (:s, :e, cast(:p as jsonb), :c, cast(:b as jsonb), :h)
                    """
                ),
                {
                    "s": self.name,
                    "e": endpoint,
                    "p": json.dumps(params) if params else None,
                    "c": status,
                    "b": dumped,
                    "h": body_hash,
                },
            )
