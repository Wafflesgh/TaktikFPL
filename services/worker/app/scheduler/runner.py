"""Wrapper job: setiap eksekusi tercatat di job_runs (mulai, selesai, status, stats, error)."""

import functools
import json
import traceback
from collections.abc import Callable
from datetime import datetime
from typing import Any, ParamSpec

import structlog
from sqlalchemy import text

from app.db import get_engine

log = structlog.get_logger()

P = ParamSpec("P")

# Registri nama job → fungsi (dipakai endpoint admin & CLI)
JOBS: dict[str, Callable[..., dict[str, Any] | None]] = {}


class JobSkipped(Exception):
    """Dilempar job untuk menandai status 'skipped' (mis. prasyarat belum terpenuhi)."""


def job(name: str) -> Callable[[Callable[P, dict[str, Any] | None]], Callable[P, dict[str, Any] | None]]:
    def decorator(fn: Callable[P, dict[str, Any] | None]) -> Callable[P, dict[str, Any] | None]:
        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> dict[str, Any] | None:
            scheduled_for: datetime | None = kwargs.pop("scheduled_for", None)  # type: ignore[assignment]
            engine = get_engine()
            with engine.begin() as conn:
                run_id = conn.execute(
                    text(
                        "insert into public.job_runs (job_name, scheduled_for) values (:n, :s) returning id"
                    ),
                    {"n": name, "s": scheduled_for},
                ).scalar_one()
            log.info("job.start", job=name, run_id=run_id)
            status, stats, error = "ok", None, None
            try:
                stats = fn(*args, **kwargs)
                return stats
            except JobSkipped as exc:
                status, error = "skipped", str(exc)
                return None
            except Exception as exc:
                status, error = "failed", "".join(traceback.format_exception(exc))[-4000:]
                log.error("job.failed", job=name, run_id=run_id, error=str(exc))
                raise
            finally:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "update public.job_runs set finished_at = now(), status = :st, "
                            "stats = cast(:stats as jsonb), error = :err where id = :id"
                        ),
                        {
                            "st": status,
                            "stats": json.dumps(stats, default=str) if stats is not None else None,
                            "err": error,
                            "id": run_id,
                        },
                    )
                log.info("job.finish", job=name, run_id=run_id, status=status, stats=stats)

        JOBS[name] = wrapper
        return wrapper

    return decorator
