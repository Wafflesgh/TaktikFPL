"""Arsip permanen payload mentah (JSON gzip immutable) + manifest di public.data_archives.

Backend:
- `supabase`: bucket privat `archive` di Supabase Storage (produksi; butuh SUPABASE_SECRET_KEY).
- `local`: folder di disk (ARCHIVE_DIR) untuk pengembangan & test.

Arsip tidak pernah ditimpa atau dihapus oleh job mana pun. Data turunan (fitur, proyeksi) boleh
dipangkas karena bisa dihitung ulang dari arsip ini.
"""

import gzip
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import Settings, get_settings

log = structlog.get_logger()

REASONS = ("daily", "deadline", "gw_final", "season_end", "backfill", "manual")


class ArchiveBackend(Protocol):
    name: str

    def put(self, path: str, data: bytes) -> None: ...

    def get(self, path: str) -> bytes: ...


class LocalArchiveBackend:
    name = "local"

    def __init__(self, root: Path):
        self.root = root

    def put(self, path: str, data: bytes) -> None:
        target = self.root / path
        if target.exists():
            raise FileExistsError(f"arsip immutable sudah ada: {path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def get(self, path: str) -> bytes:
        return (self.root / path).read_bytes()


class SupabaseArchiveBackend:
    name = "supabase"

    def __init__(
        self,
        supabase_url: str,
        secret_key: str,
        bucket: str = "archive",
        transport: httpx.BaseTransport | None = None,
    ):
        headers = {"apikey": secret_key}
        if secret_key.startswith("eyJ"):  # kunci legacy service_role (JWT)
            headers["Authorization"] = f"Bearer {secret_key}"
        self._bucket = bucket
        self._http = httpx.Client(
            base_url=f"{supabase_url.rstrip('/')}/storage/v1/",
            headers=headers,
            timeout=60,
            transport=transport,
        )

    def put(self, path: str, data: bytes) -> None:
        resp = self._http.post(
            f"object/{self._bucket}/{path}",
            content=data,
            headers={"Content-Type": "application/gzip", "x-upsert": "false"},
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"upload arsip gagal ({resp.status_code}): {resp.text[:300]}")

    def get(self, path: str) -> bytes:
        resp = self._http.get(f"object/{self._bucket}/{path}")
        resp.raise_for_status()
        return resp.content


def get_backend(settings: Settings | None = None) -> ArchiveBackend:
    s = settings or get_settings()
    backend = s.archive_backend
    if backend == "auto":
        backend = "supabase" if s.supabase_secret_key else "local"
    if backend == "supabase":
        return SupabaseArchiveBackend(s.supabase_url, s.supabase_secret_key, s.archive_bucket)
    return LocalArchiveBackend(Path(s.archive_dir))


def canonical_bytes(payload: Any) -> bytes:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def _slug(endpoint: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", endpoint.lower()).strip("-") or "root"


def build_path(
    source: str,
    season_label: str | None,
    endpoint: str,
    captured_at: datetime,
    reason: str,
    sha: str,
    ext: str = "json",
) -> str:
    """fpl/2026-27/bootstrap-static/2026/10/20/163555Z-daily-1a2b3c4d.json.gz"""
    season = (season_label or "no-season").replace("/", "-")
    ts = captured_at.astimezone(UTC)
    return f"{source}/{season}/{_slug(endpoint)}/{ts:%Y/%m/%d}/{ts:%H%M%S}Z-{reason}-{sha[:8]}.{ext}.gz"


@dataclass(frozen=True)
class ArchiveResult:
    path: str | None
    bytes: int
    sha256: str
    skipped_duplicate: bool


def archive_payload(
    conn: Connection,
    *,
    source: str,
    endpoint: str,
    payload: Any,
    reason: str,
    season_label: str | None,
    gameweek: int | None = None,
    record_count: int | None = None,
    meta: dict[str, Any] | None = None,
    backend: ArchiveBackend | None = None,
    captured_at: datetime | None = None,
) -> ArchiveResult:
    """Simpan payload JSON sebagai arsip immutable. Isi identik dengan arsip terakhir endpoint
    yang sama tidak disimpan ulang (cukup satu salinan per versi data)."""
    return archive_bytes(
        conn,
        source=source,
        endpoint=endpoint,
        raw=canonical_bytes(payload),
        ext="json",
        reason=reason,
        season_label=season_label,
        gameweek=gameweek,
        record_count=record_count,
        meta=meta,
        backend=backend,
        captured_at=captured_at,
    )


def archive_bytes(
    conn: Connection,
    *,
    source: str,
    endpoint: str,
    raw: bytes,
    ext: str,
    reason: str,
    season_label: str | None,
    gameweek: int | None = None,
    record_count: int | None = None,
    meta: dict[str, Any] | None = None,
    backend: ArchiveBackend | None = None,
    captured_at: datetime | None = None,
) -> ArchiveResult:
    """Arsip isi mentah apa adanya (mis. CSV dataset historis), di-gzip. sha256 = hash isi asli."""
    if reason not in REASONS:
        raise ValueError(f"reason tidak valid: {reason}")
    sha = hashlib.sha256(raw).hexdigest()
    last_sha = conn.execute(
        text(
            "select sha256 from public.data_archives where source = :s and endpoint = :e "
            "order by captured_at desc limit 1"
        ),
        {"s": source, "e": endpoint},
    ).scalar()
    if last_sha == sha:
        return ArchiveResult(None, 0, sha, True)

    when = captured_at or datetime.now(UTC)
    path = build_path(source, season_label, endpoint, when, reason, sha, ext)
    data = gzip.compress(raw, compresslevel=9, mtime=0)
    store = backend or get_backend()
    store.put(path, data)
    conn.execute(
        text(
            """
            insert into public.data_archives
              (source, endpoint, season_label, gameweek, reason, captured_at, storage_backend,
               path, bytes, sha256, record_count, meta)
            values (:source, :endpoint, :season, :gw, :reason, :captured, :backend,
                    :path, :bytes, :sha, :count, cast(:meta as jsonb))
            """
        ),
        {
            "source": source,
            "endpoint": endpoint,
            "season": season_label,
            "gw": gameweek,
            "reason": reason,
            "captured": when,
            "backend": store.name,
            "path": path,
            "bytes": len(data),
            "sha": sha,
            "count": record_count,
            "meta": json.dumps(meta or {}),
        },
    )
    log.info("archive.saved", path=path, bytes=len(data), reason=reason)
    return ArchiveResult(path, len(data), sha, False)


def read_archive(path: str, backend: ArchiveBackend | None = None) -> Any:
    store = backend or get_backend()
    return json.loads(gzip.decompress(store.get(path)))


def last_archived_at(conn: Connection, source: str, endpoint: str) -> datetime | None:
    return conn.execute(
        text("select max(captured_at) from public.data_archives where source = :s and endpoint = :e"),
        {"s": source, "e": endpoint},
    ).scalar()


def current_season_label(conn: Connection) -> str | None:
    return conn.execute(text("select label from public.seasons where is_current")).scalar()


def archive_if_due(
    conn: Connection,
    *,
    source: str,
    endpoint: str,
    payload: Any,
    reason: str | None,
    gameweek: int | None = None,
    record_count: int | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """reason=None → arsip 'daily' bila arsip terakhir lebih tua dari ARCHIVE_DAILY_MIN_HOURS.
    reason diisi (mis. 'deadline', 'gw_final') → selalu diarsip (kecuali isinya identik)."""
    s = settings or get_settings()
    if reason is None:
        last = last_archived_at(conn, source, endpoint)
        age_h = (datetime.now(UTC) - last).total_seconds() / 3600 if last else None
        if age_h is not None and age_h < s.archive_daily_min_hours:
            return {"archived": False, "why": "not_due"}
        reason = "daily"
    res = archive_payload(
        conn,
        source=source,
        endpoint=endpoint,
        payload=payload,
        reason=reason,
        season_label=current_season_label(conn),
        gameweek=gameweek,
        record_count=record_count,
    )
    return {"archived": not res.skipped_duplicate, "reason": reason, "path": res.path, "bytes": res.bytes}
