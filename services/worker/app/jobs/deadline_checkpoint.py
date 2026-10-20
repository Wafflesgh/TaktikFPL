"""Checkpoint deadline dinamis (T-48j … T-15m), BLUEPRINT 9.3.

Fase 1: refresh penuh data FPL di setiap checkpoint. Fase 2 menambahkan berita, odds,
proyeksi ulang (jika input_hash berubah), Gemini, dan Laporan Deadline T-60.
"""

from typing import Any

from app.jobs.sync_bootstrap import sync_bootstrap
from app.jobs.sync_fixtures import sync_fixtures
from app.scheduler.runner import job


@job("deadline_checkpoint")
def deadline_checkpoint(gw: int, minutes_before: int) -> dict[str, Any]:
    bootstrap = sync_bootstrap()
    fixtures = sync_fixtures()
    return {
        "gw": gw,
        "minutes_before": minutes_before,
        "bootstrap_ok": bootstrap is not None,
        "fixture_changes": len((fixtures or {}).get("changes", [])),
    }
