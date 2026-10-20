"""sync_fixtures: fixtures/ FPL → fixtures (PL) + deteksi perubahan jadwal → fixture_changes."""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.archive.store import archive_if_due
from app.config import get_settings
from app.db import get_engine
from app.jobs.sync_bootstrap import current_season_id
from app.scheduler.runner import JobSkipped, job
from app.sources.fpl import FixtureRow, FPLClient, parse_fixtures

log = structlog.get_logger()

# Status yang perubahannya relevan sebagai "perubahan jadwal". Progres normal
# scheduled → live → finished tidak dicatat.
DISRUPTED = {"postponed", "cancelled", "abandoned", "tbc"}


@dataclass(frozen=True)
class FixtureSnapshot:
    gw: int | None
    kickoff_utc: datetime | None
    status: str

    def as_json(self) -> dict[str, Any]:
        return {
            "gw": self.gw,
            "kickoff_utc": self.kickoff_utc.isoformat() if self.kickoff_utc else None,
            "status": self.status,
        }


@dataclass(frozen=True)
class Change:
    change_type: str
    old_value: dict[str, Any] | None
    new_value: dict[str, Any]


def detect_changes(old: FixtureSnapshot | None, new: FixtureSnapshot) -> list[Change]:
    """Bandingkan snapshot tersimpan vs data baru (BLUEPRINT 9.2). Fungsi murni."""
    if old is None:
        return [Change("created", None, new.as_json())]
    changes: list[Change] = []
    if old.gw != new.gw:
        if new.gw is None:
            ctype = "postponed"  # event menjadi null → blank untuk dua tim
        elif old.gw is None:
            ctype = "rescheduled"
        else:
            ctype = "gameweek_moved"
        changes.append(Change(ctype, {"gw": old.gw}, {"gw": new.gw}))
    if old.kickoff_utc != new.kickoff_utc:
        changes.append(
            Change(
                "kickoff_moved",
                {"kickoff_utc": old.kickoff_utc.isoformat() if old.kickoff_utc else None},
                {"kickoff_utc": new.kickoff_utc.isoformat() if new.kickoff_utc else None},
            )
        )
    already_postponed = any(c.change_type == "postponed" for c in changes)
    if old.status != new.status and (old.status in DISRUPTED or new.status in DISRUPTED):
        if not (already_postponed and new.status == "postponed"):
            changes.append(Change("status_changed", {"status": old.status}, {"status": new.status}))
    return changes


def apply_fixtures(conn: Connection, rows: list[FixtureRow], source: str = "fpl") -> dict[str, Any]:
    season_id = current_season_id(conn)
    competition_id = conn.execute(text("select id from public.competitions where code = 'PL'")).scalar()
    if competition_id is None:
        raise JobSkipped("kompetisi PL belum ada — jalankan seed")
    team_map = {
        int(fid): int(tid)
        for fid, tid in conn.execute(
            text(
                "select fpl_team_id, team_id from public.team_seasons "
                "where season_id = :s and fpl_team_id is not null"
            ),
            {"s": season_id},
        )
    }
    if not team_map:
        raise JobSkipped("team_seasons kosong — jalankan sync_bootstrap dulu")
    gw_by_number = {
        int(n): int(i)
        for i, n in conn.execute(
            text("select id, number from public.gameweeks where season_id = :s"), {"s": season_id}
        )
    }
    gw_number_by_id = {v: k for k, v in gw_by_number.items()}

    existing: dict[int, FixtureSnapshot] = {}
    for r in conn.execute(
        text(
            "select fpl_fixture_id, gameweek_id, kickoff_utc, status from public.fixtures "
            "where season_id = :s and fpl_fixture_id is not null"
        ),
        {"s": season_id},
    ):
        existing[int(r.fpl_fixture_id)] = FixtureSnapshot(
            gw_number_by_id.get(r.gameweek_id) if r.gameweek_id else None, r.kickoff_utc, r.status
        )
    initial_load = not existing

    pending: list[tuple[int, Change]] = []
    params = []
    for f in rows:
        if f.fpl_team_h not in team_map or f.fpl_team_a not in team_map:
            log.warning("fixtures.unknown_team", fpl_fixture_id=f.fpl_fixture_id)
            continue
        new = FixtureSnapshot(f.event, f.kickoff_utc, f.status)
        changes = detect_changes(existing.get(f.fpl_fixture_id), new)
        if initial_load:
            changes = [c for c in changes if c.change_type != "created"]
        pending.extend((f.fpl_fixture_id, c) for c in changes)
        params.append(
            {
                "s": season_id,
                "c": competition_id,
                "gw": gw_by_number.get(f.event) if f.event is not None else None,
                "h": team_map[f.fpl_team_h],
                "a": team_map[f.fpl_team_a],
                "ko": f.kickoff_utc,
                "st": f.status,
                "min": f.minute,
                "hg": f.home_goals,
                "ag": f.away_goals,
                "fid": f.fpl_fixture_id,
                "dh": f.difficulty_home,
                "da": f.difficulty_away,
            }
        )

    if params:
        conn.execute(
            text(
                """
                insert into public.fixtures
                  (season_id, competition_id, gameweek_id, home_team_id, away_team_id, kickoff_utc,
                   status, minute, home_goals, away_goals, fpl_fixture_id, difficulty_home, difficulty_away)
                values (:s, :c, :gw, :h, :a, :ko, :st, :min, :hg, :ag, :fid, :dh, :da)
                on conflict (season_id, fpl_fixture_id) where fpl_fixture_id is not null do update
                  set gameweek_id = excluded.gameweek_id,
                      home_team_id = excluded.home_team_id,
                      away_team_id = excluded.away_team_id,
                      kickoff_utc = excluded.kickoff_utc,
                      status = excluded.status,
                      minute = excluded.minute,
                      home_goals = excluded.home_goals,
                      away_goals = excluded.away_goals,
                      difficulty_home = excluded.difficulty_home,
                      difficulty_away = excluded.difficulty_away
                  where (public.fixtures.gameweek_id, public.fixtures.kickoff_utc, public.fixtures.status,
                         public.fixtures.minute, public.fixtures.home_goals, public.fixtures.away_goals,
                         public.fixtures.difficulty_home, public.fixtures.difficulty_away,
                         public.fixtures.home_team_id, public.fixtures.away_team_id)
                        is distinct from
                        (excluded.gameweek_id, excluded.kickoff_utc, excluded.status, excluded.minute,
                         excluded.home_goals, excluded.away_goals, excluded.difficulty_home,
                         excluded.difficulty_away, excluded.home_team_id, excluded.away_team_id)
                """
            ),
            params,
        )

    if pending:
        id_by_fpl = {
            int(fid): int(i)
            for i, fid in conn.execute(
                text(
                    "select id, fpl_fixture_id from public.fixtures "
                    "where season_id = :s and fpl_fixture_id = any(:ids)"
                ),
                {"s": season_id, "ids": list({fid for fid, _ in pending})},
            )
        }
        conn.execute(
            text(
                """
                insert into public.fixture_changes (fixture_id, change_type, old_value, new_value, source)
                values (:fx, :ct, cast(:old as jsonb), cast(:new as jsonb), :src)
                """
            ),
            [
                {
                    "fx": id_by_fpl[fid],
                    "ct": c.change_type,
                    "old": json.dumps(c.old_value) if c.old_value is not None else None,
                    "new": json.dumps(c.new_value),
                    "src": source,
                }
                for fid, c in pending
            ],
        )

    # Hitung ulang penanda Blank/Double GW dari jumlah laga per tim per GW.
    flagged = conn.execute(
        text(
            """
            update public.gameweeks g
               set is_blank = c.blank, is_double = c.dbl
              from (
                select gameweek_id,
                       bool_or(fixture_count = 0)  as blank,
                       bool_or(fixture_count >= 2) as dbl
                from public.v_gw_team_fixture_counts
                group by gameweek_id
              ) c
             where g.id = c.gameweek_id
               and (g.is_blank, g.is_double) is distinct from (c.blank, c.dbl)
            """
        )
    ).rowcount

    return {
        "fixtures": len(params),
        "initial_load": initial_load,
        "changes": [
            {"fpl_fixture_id": fid, "type": c.change_type, "old": c.old_value, "new": c.new_value}
            for fid, c in pending
        ],
        "gameweek_flags_updated": flagged,
    }


@job("sync_fixtures")
def sync_fixtures(archive_reason: str | None = None) -> dict[str, Any]:
    settings = get_settings()
    engine = get_engine()
    with FPLClient(settings.fpl_base_url, settings.fpl_requests_per_second, engine) as fpl:
        payload = fpl.fixtures()
    with engine.begin() as conn:
        stats = apply_fixtures(conn, parse_fixtures(payload))
    with engine.begin() as conn:
        stats["archive"] = archive_if_due(
            conn,
            source="fpl",
            endpoint="fixtures/",
            payload=payload,
            reason=archive_reason,
            record_count=len(payload),
        )
    if stats["changes"]:
        # Fase 2: notifikasi push/Telegram + trigger run_projections untuk GW terdampak.
        log.warning("fixtures.schedule_changed", count=len(stats["changes"]))
    return stats
