"""sync_bootstrap: bootstrap-static → seasons, teams, players, gameweeks, status & harga."""

from datetime import UTC, date, datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.archive.store import archive_if_due
from app.config import get_settings
from app.db import get_engine
from app.scheduler.runner import JobSkipped, job
from app.sources.fpl import (
    FPLClient,
    parse_events,
    parse_players,
    parse_teams,
)

log = structlog.get_logger()


def current_season_id(conn: Connection) -> int:
    season_id = conn.execute(text("select id from public.seasons where is_current")).scalar()
    if season_id is None:
        raise JobSkipped("belum ada musim is_current — jalankan seed (supabase/seed.sql)")
    return int(season_id)


def _upsert_teams(conn: Connection, season_id: int, data: dict[str, Any]) -> dict[int, int]:
    """Kembalikan peta fpl_team_id (1..20) → teams.id."""
    fpl_to_team: dict[int, int] = {}
    for t in parse_teams(data):
        team_id = conn.execute(
            text(
                """
                insert into public.teams (name, short_name, fpl_team_code)
                values (:name, :short, :code)
                on conflict (fpl_team_code) do update
                  set name = excluded.name, short_name = excluded.short_name
                  where (public.teams.name, public.teams.short_name)
                        is distinct from (excluded.name, excluded.short_name)
                returning id
                """
            ),
            {"name": t.name, "short": t.short_name, "code": t.code},
        ).scalar()
        if team_id is None:  # tidak berubah → ambil id yang ada
            team_id = conn.execute(
                text("select id from public.teams where fpl_team_code = :code"), {"code": t.code}
            ).scalar_one()
        conn.execute(
            text(
                """
                insert into public.team_external_ids (team_id, source, external_id)
                values (:tid, 'fpl', :ext)
                on conflict (source, external_id) do update set team_id = excluded.team_id
                """
            ),
            {"tid": team_id, "ext": str(t.code)},
        )
        fpl_to_team[t.fpl_team_id] = int(team_id)

    # Lepas fpl_team_id lama musim ini dulu agar unique (season_id, fpl_team_id) tidak bentrok.
    conn.execute(
        text(
            "update public.team_seasons set fpl_team_id = null where season_id = :s and team_id <> all(:tids)"
        ),
        {"s": season_id, "tids": list(fpl_to_team.values())},
    )
    conn.execute(
        text(
            """
            insert into public.team_seasons (team_id, season_id, fpl_team_id, league_code)
            values (:tid, :s, :fid, 'PL')
            on conflict (team_id, season_id) do update set fpl_team_id = excluded.fpl_team_id
            """
        ),
        [{"tid": tid, "s": season_id, "fid": fid} for fid, tid in fpl_to_team.items()],
    )
    return fpl_to_team


def _upsert_players(
    conn: Connection, season_id: int, data: dict[str, Any], fpl_to_team: dict[int, int], today: date
) -> dict[str, int]:
    players = parse_players(data)
    if not players:
        return {"players": 0, "status_snapshots": 0, "price_snapshots": 0, "moved": 0}

    conn.execute(
        text(
            """
            insert into public.players (full_name, web_name, fpl_code, photo_file)
            values (:full, :web, :code, :photo)
            on conflict (fpl_code) do update
              set full_name = excluded.full_name,
                  web_name = excluded.web_name,
                  photo_file = excluded.photo_file
              where (public.players.full_name, public.players.web_name, public.players.photo_file)
                    is distinct from (excluded.full_name, excluded.web_name, excluded.photo_file)
            """
        ),
        [{"full": p.full_name, "web": p.web_name, "code": p.code, "photo": p.photo_file} for p in players],
    )
    code_to_id = {
        int(code): int(pid)
        for pid, code in conn.execute(
            text("select id, fpl_code from public.players where fpl_code = any(:codes)"),
            {"codes": [p.code for p in players]},
        )
    }
    conn.execute(
        text(
            """
            insert into public.player_external_ids (player_id, source, external_id)
            values (:pid, 'fpl_code', :ext)
            on conflict (source, external_id) do nothing
            """
        ),
        [{"pid": code_to_id[p.code], "ext": str(p.code)} for p in players],
    )

    # Pemain pindah klub di tengah musim: tutup baris lama (left_on) & lepas fpl_element_id-nya.
    active = {
        int(pid): int(tid)
        for pid, tid in conn.execute(
            text(
                "select player_id, team_id from public.player_seasons "
                "where season_id = :s and left_on is null"
            ),
            {"s": season_id},
        )
    }
    moved = [
        {"pid": code_to_id[p.code], "old": active[code_to_id[p.code]]}
        for p in players
        if code_to_id[p.code] in active and active[code_to_id[p.code]] != fpl_to_team[p.fpl_team_id]
    ]
    if moved:
        conn.execute(
            text(
                "update public.player_seasons set left_on = :today, fpl_element_id = null "
                "where player_id = :pid and season_id = :s and team_id = :old"
            ),
            [{**m, "s": season_id, "today": today} for m in moved],
        )
    conn.execute(
        text(
            """
            insert into public.player_seasons (player_id, season_id, team_id, fpl_element_id, fpl_position)
            values (:pid, :s, :tid, :eid, :pos)
            on conflict (player_id, season_id, team_id) do update
              set fpl_element_id = excluded.fpl_element_id,
                  fpl_position = excluded.fpl_position,
                  left_on = null
            """
        ),
        [
            {
                "pid": code_to_id[p.code],
                "s": season_id,
                "tid": fpl_to_team[p.fpl_team_id],
                "eid": p.fpl_element_id,
                "pos": p.position,
            }
            for p in players
        ],
    )

    # Snapshot status: insert hanya jika berbeda dari snapshot terakhir.
    latest = {
        int(r.player_id): (r.status, r.chance_next, r.chance_this, r.news, r.news_added_utc)
        for r in conn.execute(
            text(
                """
                select distinct on (player_id)
                  player_id, status, chance_next, chance_this, news, news_added_utc
                from public.player_status_snapshots
                where player_id = any(:ids)
                order by player_id, captured_at desc
                """
            ),
            {"ids": list(code_to_id.values())},
        )
    }
    changed = [p for p in players if latest.get(code_to_id[p.code]) != p.status_key()]
    if changed:
        conn.execute(
            text(
                """
                insert into public.player_status_snapshots
                  (player_id, status, chance_next, chance_this, news, news_added_utc)
                values (:pid, :status, :cn, :ct, :news, :added)
                """
            ),
            [
                {
                    "pid": code_to_id[p.code],
                    "status": p.status,
                    "cn": p.chance_next,
                    "ct": p.chance_this,
                    "news": p.news,
                    "added": p.news_added,
                }
                for p in changed
            ],
        )

    conn.execute(
        text(
            """
            insert into public.price_snapshots
              (player_id, captured_on, price_tenths, selected_by_pct, transfers_in_event, transfers_out_event)
            values (:pid, :d, :price, :sel, :tin, :tout)
            on conflict (player_id, captured_on) do update
              set price_tenths = excluded.price_tenths,
                  selected_by_pct = excluded.selected_by_pct,
                  transfers_in_event = excluded.transfers_in_event,
                  transfers_out_event = excluded.transfers_out_event
            """
        ),
        [
            {
                "pid": code_to_id[p.code],
                "d": today,
                "price": p.price_tenths,
                "sel": p.selected_by_pct,
                "tin": p.transfers_in_event,
                "tout": p.transfers_out_event,
            }
            for p in players
        ],
    )
    return {
        "players": len(players),
        "status_snapshots": len(changed),
        "price_snapshots": len(players),
        "moved": len(moved),
    }


def _upsert_gameweeks(conn: Connection, season_id: int, data: dict[str, Any]) -> dict[str, Any]:
    events = parse_events(data)
    previous = {
        int(n): d
        for n, d in conn.execute(
            text("select number, deadline_utc from public.gameweeks where season_id = :s"),
            {"s": season_id},
        )
    }
    if events:
        conn.execute(
            text(
                """
                insert into public.gameweeks
                  (season_id, number, fpl_event_id, deadline_utc, is_current, is_next, is_finished)
                values (:s, :n, :n, :deadline, :cur, :next, :fin)
                on conflict (season_id, number) do update
                  set fpl_event_id = excluded.fpl_event_id,
                      deadline_utc = excluded.deadline_utc,
                      is_current = excluded.is_current,
                      is_next = excluded.is_next,
                      is_finished = excluded.is_finished
                  where (public.gameweeks.deadline_utc, public.gameweeks.is_current,
                         public.gameweeks.is_next, public.gameweeks.is_finished)
                        is distinct from (excluded.deadline_utc, excluded.is_current,
                                          excluded.is_next, excluded.is_finished)
                """
            ),
            [
                {
                    "s": season_id,
                    "n": e.number,
                    "deadline": e.deadline_utc,
                    "cur": e.is_current,
                    "next": e.is_next,
                    "fin": e.is_finished,
                }
                for e in events
            ],
        )
        # end_date musim: tanggal deadline GW terakhir (laga GW38 dimainkan di hari yang sama).
        conn.execute(
            text("update public.seasons set end_date = :d where id = :s and end_date is null"),
            {"d": max(e.deadline_utc for e in events).date(), "s": season_id},
        )

    deadline_changed = [
        {"gw": e.number, "old": previous[e.number].isoformat(), "new": e.deadline_utc.isoformat()}
        for e in events
        if e.number in previous and previous[e.number] != e.deadline_utc
    ]
    nxt = next((e for e in events if e.is_next), None)
    return {
        "gameweeks": len(events),
        "deadline_changed": deadline_changed,
        "next_gw": nxt.number if nxt else None,
        "next_deadline": nxt.deadline_utc if nxt else None,
        "next_gw_new_or_changed": bool(
            nxt and (nxt.number not in previous or previous[nxt.number] != nxt.deadline_utc)
        ),
    }


def scoring_rules(data: dict[str, Any]) -> dict[str, float]:
    """game_config.scoring → {rule_key: nilai}; nilai per posisi → 'kunci_POS' (mis. goals_scored_MID)."""
    out: dict[str, float] = {}
    for key, val in ((data.get("game_config") or {}).get("scoring") or {}).items():
        if key.startswith("mng_"):
            continue  # poin manajer (chip Assistant Manager), tidak relevan untuk pemain
        if isinstance(val, dict):
            for pos, v in val.items():
                if isinstance(v, (int, float)):
                    out[f"{key}_{pos}"] = float(v)
        elif isinstance(val, (int, float)):
            out[key] = float(val)
    return out


def _upsert_scoring(conn: Connection, season_id: int, data: dict[str, Any]) -> int:
    rules = scoring_rules(data)
    if rules:
        conn.execute(
            text(
                """
                insert into public.fpl_scoring_rules (season_id, rule_key, value, notes)
                values (:s, :k, :v, 'bootstrap-static game_config.scoring')
                on conflict (season_id, rule_key) do update set value = excluded.value
                """
            ),
            [{"s": season_id, "k": k, "v": v} for k, v in rules.items()],
        )
    return len(rules)


def apply_bootstrap(conn: Connection, data: dict[str, Any], today: date) -> dict[str, Any]:
    season_id = current_season_id(conn)
    fpl_to_team = _upsert_teams(conn, season_id, data)
    stats: dict[str, Any] = {"teams": len(fpl_to_team)}
    stats.update(_upsert_players(conn, season_id, data, fpl_to_team, today))
    stats.update(_upsert_gameweeks(conn, season_id, data))
    stats["scoring_rules"] = _upsert_scoring(conn, season_id, data)
    return stats


@job("sync_bootstrap")
def sync_bootstrap(archive_reason: str | None = None) -> dict[str, Any]:
    settings = get_settings()
    engine = get_engine()
    with FPLClient(settings.fpl_base_url, settings.fpl_requests_per_second, engine) as fpl:
        data = fpl.bootstrap_static()
    with engine.begin() as conn:
        stats = apply_bootstrap(conn, data, datetime.now(UTC).date())
    # Arsip permanen setelah data diterapkan; gagal arsip = job gagal (terlihat di job_runs).
    with engine.begin() as conn:
        stats["archive"] = archive_if_due(
            conn,
            source="fpl",
            endpoint="bootstrap-static/",
            payload=data,
            reason=archive_reason,
            gameweek=stats["next_gw"],
            record_count=len(data.get("elements", [])),
        )

    if stats["next_gw_new_or_changed"] and stats["next_deadline"] is not None:
        # Deadline GW berikut baru/berubah → jadwalkan ulang semua checkpoint (BLUEPRINT 9.2).
        from app.scheduler import registry

        registry.reschedule_deadline_checkpoints(stats["next_gw"], stats["next_deadline"])
    if stats["deadline_changed"]:
        log.warning("gameweek.deadline_changed", changes=stats["deadline_changed"])
    stats["next_deadline"] = stats["next_deadline"].isoformat() if stats["next_deadline"] else None
    stats.pop("next_gw_new_or_changed")
    return stats
