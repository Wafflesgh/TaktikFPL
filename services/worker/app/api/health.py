"""GET /v1/health — status proses, DB, Redis, job terakhir, umur data tiap sumber."""

from typing import Any

import redis
from fastapi import APIRouter, Request, Response
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine

router = APIRouter()


def _redis_ok(url: str) -> bool | None:
    if not url:
        return None  # opsional di Fase 1
    try:
        client = redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)
        return bool(client.ping())
    except Exception:
        return False


@router.get("/v1/health")
def health(request: Request, response: Response) -> dict[str, Any]:
    settings = get_settings()
    leader = getattr(request.app.state, "leader", None)
    db_ok = False
    last_jobs: list[dict[str, Any]] = []
    sources: dict[str, Any] = {}
    try:
        with get_engine().connect() as conn:
            conn.execute(text("select 1"))
            db_ok = True
            last_jobs = [
                {"job_name": r.job_name, "status": r.status, "finished_at": r.finished_at}
                for r in conn.execute(
                    text(
                        """
                        select distinct on (job_name) job_name, status, finished_at
                        from public.job_runs
                        order by job_name, started_at desc
                        """
                    )
                )
            ]
            sources = {
                r.source: {"last_fetch": r.last_fetch, "requests_today": r.requests_today}
                for r in conn.execute(
                    text(
                        """
                        select source,
                               max(updated_at) as last_fetch,
                               sum(requests) filter (where usage_date = (now() at time zone 'utc')::date)
                                 as requests_today
                        from public.api_usage
                        group by source
                        """
                    )
                )
            }
    except Exception:
        db_ok = False

    if not db_ok:
        response.status_code = 503
    return {
        "status": "ok" if db_ok else "degraded",
        "version": settings.app_version,
        "is_leader": bool(leader and leader.is_leader),
        "db_ok": db_ok,
        "redis_ok": _redis_ok(settings.redis_url),
        "last_jobs": last_jobs,
        "sources": sources,
        "ai_tier": settings.ai_tier,
        "missing_optional_env": settings.missing_optional_env(),
    }
