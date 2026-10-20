"""gw_finalize: arsip permanen data final satu GW (+ snapshot akhir musim sebelum API FPL reset).

Dipicu poll_event_status untuk setiap GW yang sudah final tetapi belum punya arsip `gw_final`
(self-healing: jika gagal, dicoba lagi di putaran berikutnya). Bisa juga dijalankan manual:
`python -m app.cli gw_finalize:gw=7`.

Fase 2 menambahkan: dream-team untuk GW Review dan evaluasi model (model_evaluations).
"""

from typing import Any

import structlog
from sqlalchemy import text

from app.archive.store import archive_payload, current_season_label
from app.config import get_settings
from app.db import get_engine
from app.jobs.sync_bootstrap import current_season_id
from app.scheduler.runner import job
from app.sources.base import SourceHTTPError
from app.sources.fpl import FPLClient

log = structlog.get_logger()

LIVE_ENDPOINT = "event/{gw}/live/"


def pending_finalization(conn: Any) -> list[int]:
    """GW final yang belum punya arsip event live. Final = scores_final_at terisi, ATAU GW sudah
    selesai dan lebih awal dari GW berjalan (menutup GW lampau saat aplikasi mulai di tengah musim)."""
    rows = conn.execute(
        text(
            """
            select g.number
            from public.gameweeks g
            join public.seasons s on s.id = g.season_id and s.is_current
            where g.is_finished
              and (
                g.scores_final_at is not null
                or g.number < (select max(c.number) from public.gameweeks c
                               where c.season_id = g.season_id and c.is_current)
              )
              and not exists (
                select 1 from public.data_archives a
                where a.source = 'fpl' and a.reason = 'gw_final'
                  and a.endpoint = 'event/' || g.number || '/live/'
                  and a.season_label = s.label
              )
            order by g.number
            """
        )
    ).all()
    return [int(r.number) for r in rows]


@job("gw_finalize")
def gw_finalize(gw: int) -> dict[str, Any]:
    gw = int(gw)
    settings = get_settings()
    engine = get_engine()
    with FPLClient(settings.fpl_base_url, settings.fpl_requests_per_second, engine) as fpl:
        payloads: list[tuple[str, Any, int | None]] = []
        live = fpl.event_live(gw)
        payloads.append((LIVE_ENDPOINT.format(gw=gw), live, len(live.get("elements", []))))
        fixtures = fpl.fixtures(event=gw)
        payloads.append((f"fixtures/?event={gw}", fixtures, len(fixtures)))
        try:
            dream = fpl.dream_team(gw)
            payloads.append((f"dream-team/{gw}/", dream, len(dream.get("team", []))))
        except SourceHTTPError as exc:  # opsional; jangan gagalkan arsip utama
            log.warning("gw_finalize.dream_team_unavailable", gw=gw, error=str(exc))
        payloads.append(("team/set-piece-notes/", fpl.set_piece_notes(), None))

    archived = []
    with engine.begin() as conn:
        season_id = current_season_id(conn)
        season_label = current_season_label(conn)
        for endpoint, payload, count in payloads:
            res = archive_payload(
                conn,
                source="fpl",
                endpoint=endpoint,
                payload=payload,
                reason="gw_final",
                season_label=season_label,
                gameweek=gw,
                record_count=count,
            )
            archived.append({"endpoint": endpoint, "path": res.path, "bytes": res.bytes})
        final_rows = conn.execute(
            text(
                """
                update public.player_fpl_gw_stats s set is_final = true
                from public.gameweeks g
                where g.id = s.gameweek_id and g.season_id = :s and g.number = :gw and not s.is_final
                """
            ),
            {"s": season_id, "gw": gw},
        ).rowcount
        last_gw = conn.execute(
            text("select max(number) from public.gameweeks where season_id = :s"), {"s": season_id}
        ).scalar()

    stats: dict[str, Any] = {"gw": gw, "archived": archived, "rows_marked_final": final_rows}
    if last_gw is not None and gw == int(last_gw):
        stats["season_end"] = archive_season_snapshot()
    return stats


@job("archive_season_snapshot")
def archive_season_snapshot() -> dict[str, Any]:
    """Arsipkan element-summary SEMUA pemain (riwayat per laga + history_past) dalam satu file.

    API FPL di-reset saat musim baru dimulai; ini salinan terakhir yang lengkap. ±11 menit.
    """
    settings = get_settings()
    engine = get_engine()
    with engine.connect() as conn:
        season_id = current_season_id(conn)
        elements = [
            int(r.fpl_element_id)
            for r in conn.execute(
                text(
                    "select fpl_element_id from public.player_seasons "
                    "where season_id = :s and fpl_element_id is not null order by fpl_element_id"
                ),
                {"s": season_id},
            )
        ]
    summaries: dict[str, Any] = {}
    errors = 0
    with FPLClient(settings.fpl_base_url, settings.fpl_requests_per_second, engine) as fpl:
        bootstrap = fpl.bootstrap_static()
        for element_id in elements:
            try:
                summaries[str(element_id)] = fpl.element_summary(element_id, store_raw=False)
            except SourceHTTPError as exc:
                errors += 1
                log.warning("season_snapshot.fetch_failed", element=element_id, error=str(exc))
    with engine.begin() as conn:
        season_label = current_season_label(conn)
        res_summary = archive_payload(
            conn,
            source="fpl",
            endpoint="element-summary/*",
            payload=summaries,
            reason="season_end",
            season_label=season_label,
            record_count=len(summaries),
            meta={"errors": errors},
        )
        res_boot = archive_payload(
            conn,
            source="fpl",
            endpoint="bootstrap-static/",
            payload=bootstrap,
            reason="season_end",
            season_label=season_label,
            record_count=len(bootstrap.get("elements", [])),
        )
    return {
        "players": len(summaries),
        "errors": errors,
        "element_summary_path": res_summary.path,
        "bootstrap_path": res_boot.path,
    }
