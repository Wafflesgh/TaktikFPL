"""cleanup_retention: hapus data operasional lama sesuai app_config.retention_days."""

from typing import Any

from sqlalchemy import text

from app.db import get_engine
from app.scheduler.runner import job

DEFAULT_RETENTION = {"raw_payloads": 14, "odds_snapshots": 90, "ai_cache": 30, "job_runs": 60}

# tabel → kolom waktu acuan
TIME_COLUMN = {
    "raw_payloads": "fetched_at",
    "odds_snapshots": "captured_at",
    "ai_cache": "created_at",
    "job_runs": "started_at",
}


@job("cleanup_retention")
def cleanup_retention() -> dict[str, Any]:
    engine = get_engine()
    deleted: dict[str, int] = {}
    with engine.begin() as conn:
        cfg = conn.execute(text("select value from public.app_config where key = 'retention_days'")).scalar()
        retention = {**DEFAULT_RETENTION, **(cfg or {})}
        for table, column in TIME_COLUMN.items():
            days = int(retention[table])
            # nama tabel/kolom berasal dari konstanta di atas, bukan input pengguna
            deleted[table] = conn.execute(
                text(f"delete from public.{table} where {column} < now() - make_interval(days => :d)"),
                {"d": days},
            ).rowcount
        deleted["ai_cache_expired"] = conn.execute(
            text("delete from public.ai_cache where expires_at is not null and expires_at < now()")
        ).rowcount
    return {"deleted": deleted}
