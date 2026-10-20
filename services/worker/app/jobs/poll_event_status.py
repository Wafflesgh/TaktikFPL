"""poll_event_status: event-status/ → gameweeks.bonus_confirmed / leagues_updated / scores_final_at."""

from typing import Any

import structlog
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine
from app.jobs.gw_finalize import gw_finalize, pending_finalization
from app.jobs.sync_bootstrap import current_season_id
from app.scheduler.runner import job
from app.sources.fpl import FPLClient, parse_event_status

log = structlog.get_logger()


@job("poll_event_status")
def poll_event_status() -> dict[str, Any]:
    settings = get_settings()
    engine = get_engine()
    with FPLClient(settings.fpl_base_url, settings.fpl_requests_per_second, engine) as fpl:
        parsed = parse_event_status(fpl.event_status())

    finalized: list[int] = []
    with engine.begin() as conn:
        season_id = current_season_id(conn)
        for gw, flags in parsed.items():
            conn.execute(
                text(
                    """
                    update public.gameweeks
                       set bonus_confirmed = :b, leagues_updated = :l
                     where season_id = :s and number = :gw
                       and (bonus_confirmed, leagues_updated) is distinct from (:b, :l)
                    """
                ),
                {"b": flags["bonus_confirmed"], "l": flags["leagues_updated"], "s": season_id, "gw": gw},
            )
            # GW final: semua laga selesai (is_finished dari bootstrap) + bonus & liga sudah diperbarui.
            row = conn.execute(
                text(
                    """
                    update public.gameweeks set scores_final_at = now()
                     where season_id = :s and number = :gw and is_finished
                       and bonus_confirmed and leagues_updated and scores_final_at is null
                    returning number
                    """
                ),
                {"s": season_id, "gw": gw},
            ).scalar()
            if row is not None:
                finalized.append(int(row))

    for gw in finalized:
        log.info("gameweek.final", gw=gw)

    # Arsipkan setiap GW final yang belum diarsip (termasuk yang gagal di putaran sebelumnya).
    with engine.connect() as conn:
        pending = pending_finalization(conn)
    archived = []
    for gw in pending:
        gw_finalize(gw=gw)
        archived.append(gw)
    return {"events": sorted(parsed), "finalized": finalized, "archived_gws": archived}
