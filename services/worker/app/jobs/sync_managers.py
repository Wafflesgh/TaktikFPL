"""sync_managers: pelatih kepala tiap klub musim berjalan dari Wikidata → managers + manager_tenures.

Klub dicocokkan sekali (nama Understat lalu nama FPL) dan disimpan di team_external_ids
(source 'wikidata'); yang gagal dicatat di unmatched_entities. Riwayat masa jabatan disimpan
lengkap (fakta) — masa jabatan terbuka yang sudah digantikan ditutup pada tanggal pengganti mulai.
"""

from collections import defaultdict
from datetime import UTC, date, datetime
from typing import Any

import structlog
from sqlalchemy import text

from app.archive.store import archive_payload
from app.db import get_engine
from app.scheduler.runner import JobSkipped, job
from app.sources.understat import UnderstatClient, parse_team_history, season_year
from app.sources.wikidata import (
    CoachTenure,
    WikidataClient,
    parse_coaches,
    parse_search,
    parse_sitelinks,
    pick_club,
)

log = structlog.get_logger()


def close_superseded(tenures: list[CoachTenure]) -> list[CoachTenure]:
    """Per klub, urut mulai: masa jabatan tanpa tanggal selesai yang diikuti pelatih lain ditutup
    pada tanggal pelatih berikutnya mulai (Wikidata kadang terlambat mengisi P582)."""
    by_club: dict[str, list[CoachTenure]] = defaultdict(list)
    for t in tenures:
        if t.start is not None:
            by_club[t.club_qid].append(t)
    out: list[CoachTenure] = []
    for rows in by_club.values():
        rows.sort(key=lambda t: t.start or date.min)
        for i, t in enumerate(rows):
            nxt = rows[i + 1] if i + 1 < len(rows) else None
            if t.end is None and nxt is not None and nxt.start is not None and nxt.coach_qid != t.coach_qid:
                t = CoachTenure(**{**t.__dict__, "end": nxt.start})
            out.append(t)
    return out


@job("sync_managers")
def sync_managers() -> dict[str, Any]:
    engine = get_engine()
    with engine.connect() as conn:
        season = conn.execute(text("select id, label from public.seasons where is_current")).first()
        if season is None:
            raise JobSkipped("tidak ada musim berjalan")
        teams = conn.execute(
            text(
                """
                select t.id, t.name,
                       (select e.external_id from public.team_external_ids e
                        where e.team_id = t.id and e.source = 'understat' limit 1) understat_id,
                       (select e.external_id from public.team_external_ids e
                        where e.team_id = t.id and e.source = 'wikidata' limit 1) wikidata_id,
                       exists (select 1 from public.manager_tenures mt
                               where mt.team_id = t.id and mt.end_date is null) has_coach
                from public.teams t join public.team_seasons ts on ts.team_id = t.id
                where ts.season_id = :s
                """
            ),
            {"s": season.id},
        ).all()

    qid_of = {int(t.id): t.wikidata_id for t in teams if t.wikidata_id}
    # Belum dipetakan, atau dipetakan tapi tanpa pelatih aktif (kemungkinan entitas salah) → cari ulang.
    missing = [t for t in teams if not t.wikidata_id or not t.has_coach]
    unmatched: list[str] = []
    if missing:
        titles: dict[str, str] = {}
        with UnderstatClient(engine=engine) as us:
            for tm in parse_team_history(us.league_data(season_year(season.label))):
                titles[str(tm.team_id)] = tm.title
        with WikidataClient(engine=engine) as wd:
            for t in missing:
                names = [n for n in (titles.get(str(t.understat_id)), t.name) if n]
                hits = list(dict.fromkeys(q for n in names for q in parse_search(wd.search_club(n))))
                qid = pick_club(hits, parse_sitelinks(wd.sitelinks(hits)) if hits else {})
                if qid:
                    qid_of[int(t.id)] = qid
                else:
                    unmatched.append(t.name)
        with engine.begin() as conn:
            for tid, qid in qid_of.items():
                # Pemetaan id (operasional, bukan fakta) boleh diganti bila hasil pencarian berubah.
                conn.execute(
                    text(
                        """
                        delete from public.team_external_ids
                        where team_id = :t and source = 'wikidata' and external_id <> :q
                        """
                    ),
                    {"t": tid, "q": qid},
                )
                conn.execute(
                    text(
                        """
                        insert into public.team_external_ids (team_id, source, external_id)
                        values (:t, 'wikidata', :q) on conflict (source, external_id) do nothing
                        """
                    ),
                    {"t": tid, "q": qid},
                )
            for name in unmatched:
                conn.execute(
                    text(
                        """
                        insert into public.unmatched_entities (entity_type, source, external_id, raw_name)
                        values ('team', 'wikidata', :n, :n)
                        on conflict (source, entity_type, external_id) do nothing
                        """
                    ),
                    {"n": name},
                )
    if not qid_of:
        raise JobSkipped("tidak ada klub yang cocok di Wikidata")

    with WikidataClient(engine=engine) as wd:
        payload = wd.coaches(sorted(set(qid_of.values())))
    tenures = close_superseded(parse_coaches(payload))
    team_of = {q: t for t, q in qid_of.items()}

    with engine.begin() as conn:
        archive_payload(
            conn,
            source="wikidata",
            endpoint="sparql/head_coaches",
            payload=payload,
            reason="daily",
            season_label=season.label,
            record_count=len(tenures),
        )
        manager_id: dict[str, int] = {}
        for ct in tenures:
            if ct.coach_qid in manager_id:
                continue
            manager_id[ct.coach_qid] = conn.execute(
                text(
                    """
                    insert into public.managers (full_name, nationality, birth_date, wikidata_id, photo_url)
                    values (:n, :nat, :b, :q, :p)
                    on conflict (wikidata_id) do update set
                      full_name = excluded.full_name, nationality = excluded.nationality,
                      birth_date = excluded.birth_date, photo_url = excluded.photo_url
                    returning id
                    """
                ),
                {
                    "n": ct.name,
                    "nat": ct.nationality,
                    "b": ct.birth_date,
                    "q": ct.coach_qid,
                    "p": ct.photo_url,
                },
            ).scalar_one()
        # Urut mulai: masa jabatan lama ditutup dulu sebelum yang baru dibuka (indeks satu-aktif per klub).
        rows = sorted((x for x in tenures if x.club_qid in team_of), key=lambda x: x.start or date.min)
        for ct in rows:
            conn.execute(
                text(
                    """
                    insert into public.manager_tenures (manager_id, team_id, start_date, end_date, source_url)
                    values (:m, :t, :s, :e, :u)
                    on conflict (manager_id, team_id, start_date) do update set end_date = excluded.end_date
                    """
                ),
                {
                    "m": manager_id[ct.coach_qid],
                    "t": team_of[ct.club_qid],
                    "s": ct.start,
                    "e": ct.end,
                    "u": f"https://www.wikidata.org/wiki/{ct.club_qid}",
                },
            )
    stats = {"clubs": len(qid_of), "tenures": len(rows), "managers": len(manager_id), "unmatched": unmatched}
    log.info("sync_managers.done", **stats)
    return stats | {"at": datetime.now(UTC).isoformat()}
