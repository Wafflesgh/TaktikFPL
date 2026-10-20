"""cleanup_retention: hapus data operasional lama sesuai app_config.retention_days."""

from typing import Any

from sqlalchemy import text

from app.db import get_engine
from app.scheduler.runner import job

# Hanya data OPERASIONAL & TURUNAN yang dipangkas. Fakta mentah sudah diarsip permanen di
# data_archives (docs/adr/0001-data-arsip-jangka-panjang.md); tabel fakta (status, harga,
# statistik per laga, fixture_changes, proyeksi, rekomendasi) tidak pernah dihapus.
# odds_snapshots tidak dipangkas sampai adapter odds mengarsip closing odds (Fase 2).
DEFAULT_RETENTION = {"raw_payloads": 14, "ai_cache": 30, "job_runs": 60, "player_form_features_daily": 30}

# tabel → kolom waktu acuan
TIME_COLUMN = {
    "raw_payloads": "fetched_at",
    "ai_cache": "created_at",
    "job_runs": "started_at",
}

# Form harian lebih tua dari N hari dipangkas, KECUALI snapshot terakhir sebelum setiap deadline
# GW (point-in-time saat keputusan diambil) — itu disimpan permanen untuk training ML.
PRUNE_FORM_SQL = """
with keep as (
  select (select max(f.as_of) from public.player_form_features f where f.as_of <= g.deadline_utc)
         as as_of
  from public.gameweeks g
  where g.deadline_utc < now()
)
delete from public.player_form_features pf
where pf.as_of < now() - make_interval(days => :d)
  and pf.as_of not in (select k.as_of from keep k where k.as_of is not null)
"""


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
        deleted["player_form_features"] = conn.execute(
            text(PRUNE_FORM_SQL), {"d": int(retention["player_form_features_daily"])}
        ).rowcount
        deleted["ai_cache_expired"] = conn.execute(
            text("delete from public.ai_cache where expires_at is not null and expires_at < now()")
        ).rowcount
    return {"deleted": deleted}
