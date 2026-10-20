"""backfill_history: impor musim lampau dari dataset vaastav ke tabel fakta + arsip file aslinya.

`python -m app.cli backfill_history` (semua musim 2016/17 s.d. musim lalu) atau
`python -m app.cli backfill_history:seasons=2024-25,2025-26`. Idempoten (upsert).
"""

import json
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.engine import Connection
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from app.archive.store import archive_bytes
from app.db import get_engine
from app.scheduler.runner import JobSkipped, job
from app.sources import vaastav as v

log = structlog.get_logger()
BATCH = 2000


@retry(wait=wait_exponential_jitter(initial=1, max=20), stop=stop_after_attempt(4), reraise=True)
def _get(client: httpx.Client, path: str) -> str | None:
    resp = client.get(path)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.text


def fetch_season(client: httpx.Client, folder: str) -> dict[str, str | None]:
    return {
        "players_raw.csv": _get(client, f"{folder}/players_raw.csv"),
        "gws/merged_gw.csv": _get(client, f"{folder}/gws/merged_gw.csv"),
        "fixtures.csv": _get(client, f"{folder}/fixtures.csv"),
        "teams.csv": _get(client, f"{folder}/teams.csv"),
    }


def _archive_files(conn: Connection, folder: str, files: dict[str, str | None]) -> int:
    n = 0
    for name, body in files.items():
        if body is None:
            continue
        res = archive_bytes(
            conn,
            source="vaastav",
            endpoint=f"data/{folder}/{name}",
            raw=body.encode("utf-8"),
            ext="csv",
            reason="backfill",
            season_label=v.season_label(folder),
            meta={"repo": "vaastav/Fantasy-Premier-League", "license": "NOASSERTION (pribadi)"},
        )
        n += 0 if res.skipped_duplicate else 1
    return n


def apply_season(
    conn: Connection, folder: str, files: dict[str, str | None], master_csv: str
) -> dict[str, Any]:
    label = v.season_label(folder)
    if not files["players_raw.csv"] or not files["gws/merged_gw.csv"]:
        return {"season": label, "skipped": "file utama tidak ada"}
    players_raw = v.read_csv(files["players_raw.csv"])
    players = v.parse_players(players_raw)
    teams = v.parse_teams(folder, files["teams.csv"], master_csv, players_raw)
    rows = v.parse_gw_rows(folder, v.read_csv(files["gws/merged_gw.csv"]))
    player_team = {p.fpl_element_id: p.fpl_team_id for p in players}
    fixtures = (
        v.parse_fixtures(folder, files["fixtures.csv"])
        if files["fixtures.csv"]
        else v.reconstruct_fixtures(rows, player_team)
    )
    kickoffs = [f.kickoff_utc for f in fixtures if f.kickoff_utc]
    if not kickoffs:
        return {"season": label, "skipped": "tanpa kick-off"}

    # --- musim
    season_id = conn.execute(
        text(
            """
            insert into public.seasons (label, start_date, end_date, is_current, data_source)
            values (:l, :s, :e, false, 'vaastav')
            on conflict (label) do update set end_date = coalesce(public.seasons.end_date, excluded.end_date)
            returning id, is_current
            """
        ),
        {"l": label, "s": min(kickoffs).date(), "e": max(kickoffs).date()},
    ).one()
    if season_id.is_current:
        raise JobSkipped(f"{label} adalah musim berjalan — tidak di-backfill")
    sid = int(season_id.id)

    # --- tim (nama terbaru dipertahankan; musim diproses dari yang terbaru)
    team_map: dict[int, int] = {}
    for t in teams:
        tid = conn.execute(
            text(
                """
                insert into public.teams (name, short_name, fpl_team_code)
                values (:n, :s, :c)
                on conflict (fpl_team_code) do update
                  set short_name = coalesce(public.teams.short_name, excluded.short_name)
                returning id
                """
            ),
            {"n": t.name, "s": t.short_name or t.name[:3].upper(), "c": t.code},
        ).scalar_one()
        team_map[t.fpl_team_id] = int(tid)
        conn.execute(
            text(
                "insert into public.team_external_ids (team_id, source, external_id) "
                "values (:t, 'fpl', :c) on conflict (source, external_id) do nothing"
            ),
            {"t": tid, "c": str(t.code)},
        )
    conn.execute(
        text(
            """
            insert into public.team_seasons (team_id, season_id, fpl_team_id, league_code)
            values (:t, :s, :f, 'PL')
            on conflict (team_id, season_id) do update set fpl_team_id = excluded.fpl_team_id
            """
        ),
        [{"t": tid, "s": sid, "f": fid} for fid, tid in team_map.items()],
    )

    # --- pemain
    conn.execute(
        text(
            """
            insert into public.players (full_name, web_name, fpl_code)
            values (:full, :web, :code)
            on conflict (fpl_code) do nothing
            """
        ),
        [{"full": p.full_name, "web": p.web_name, "code": p.code} for p in players],
    )
    code_to_id = {
        int(c): int(i)
        for i, c in conn.execute(
            text("select id, fpl_code from public.players where fpl_code = any(:c)"),
            {"c": [p.code for p in players]},
        )
    }
    conn.execute(
        text(
            "insert into public.player_external_ids (player_id, source, external_id) "
            "values (:p, 'fpl_code', :c) on conflict (source, external_id) do nothing"
        ),
        [{"p": code_to_id[p.code], "c": str(p.code)} for p in players],
    )
    known_players = [p for p in players if p.fpl_team_id in team_map]
    conn.execute(
        text(
            """
            insert into public.player_seasons (player_id, season_id, team_id, fpl_element_id, fpl_position)
            values (:p, :s, :t, :e, :pos)
            on conflict (player_id, season_id, team_id) do update
              set fpl_element_id = excluded.fpl_element_id, fpl_position = excluded.fpl_position
            """
        ),
        [
            {
                "p": code_to_id[p.code],
                "s": sid,
                "t": team_map[p.fpl_team_id],
                "e": p.fpl_element_id,
                "pos": p.position,
            }
            for p in known_players
        ],
    )

    # --- gameweek (deadline diestimasi)
    deadlines = v.estimate_deadlines(fixtures)
    conn.execute(
        text(
            """
            insert into public.gameweeks
              (season_id, number, fpl_event_id, deadline_utc, is_finished, deadline_estimated)
            values (:s, :n, :n, :d, true, true)
            on conflict (season_id, number) do update
              set deadline_utc = excluded.deadline_utc, is_finished = true, deadline_estimated = true
            """
        ),
        [{"s": sid, "n": gw, "d": d} for gw, d in sorted(deadlines.items())],
    )
    gw_ids = {
        int(n): int(i)
        for i, n in conn.execute(
            text("select id, number from public.gameweeks where season_id = :s"), {"s": sid}
        )
    }
    pl_id = conn.execute(text("select id from public.competitions where code = 'PL'")).scalar_one()

    # --- fixture
    valid_fx = [f for f in fixtures if f.fpl_team_h in team_map and f.fpl_team_a in team_map]
    conn.execute(
        text(
            """
            insert into public.fixtures
              (season_id, competition_id, gameweek_id, home_team_id, away_team_id, kickoff_utc, status,
               home_goals, away_goals, fpl_fixture_id, difficulty_home, difficulty_away)
            values (:s, :c, :gw, :h, :a, :ko, :st, :hg, :ag, :fid, :dh, :da)
            on conflict (season_id, fpl_fixture_id) where fpl_fixture_id is not null do update
              set gameweek_id = excluded.gameweek_id, kickoff_utc = excluded.kickoff_utc,
                  home_goals = excluded.home_goals, away_goals = excluded.away_goals,
                  status = excluded.status
            """
        ),
        [
            {
                "s": sid,
                "c": pl_id,
                "gw": gw_ids.get(f.gw) if f.gw is not None else None,
                "h": team_map[f.fpl_team_h],
                "a": team_map[f.fpl_team_a],
                "ko": f.kickoff_utc,
                "st": "finished"
                if f.home_goals is not None
                else "postponed"
                if f.gw is None
                else "scheduled",
                "hg": f.home_goals,
                "ag": f.away_goals,
                "fid": f.fpl_fixture_id,
                "dh": f.difficulty_home,
                "da": f.difficulty_away,
            }
            for f in valid_fx
        ],
    )
    fx_rows = conn.execute(
        text(
            "select id, fpl_fixture_id, home_team_id, away_team_id from public.fixtures "
            "where season_id = :s and fpl_fixture_id is not null"
        ),
        {"s": sid},
    ).all()
    fx_map = {int(r.fpl_fixture_id): r for r in fx_rows}

    # --- statistik per pemain per laga
    element_to_player = {p.fpl_element_id: code_to_id[p.code] for p in players}
    params, skipped = [], 0
    for r in rows:
        pid = element_to_player.get(r.fpl_element_id)
        fx = fx_map.get(r.fpl_fixture_id)
        gw_id = gw_ids.get(r.gw)
        if pid is None or fx is None or gw_id is None:
            skipped += 1
            continue
        own, opp = (fx.home_team_id, fx.away_team_id) if r.was_home else (fx.away_team_id, fx.home_team_id)
        vals = {
            k: val for k, val in r.values.items() if k not in ("kickoff_utc", "team_h_score", "team_a_score")
        }
        params.append(
            {
                **vals,
                "pid": pid,
                "fx": fx.id,
                "gw": gw_id,
                "team": own if r.was_home is not None else None,
                "opp": opp if r.was_home is not None else None,
                "home": r.was_home,
                "extra": json.dumps(r.extra),
            }
        )
    for i in range(0, len(params), BATCH):
        conn.execute(GW_UPSERT, params[i : i + BATCH])

    # --- penanda Blank/Double GW untuk musim ini
    conn.execute(
        text(
            """
            with counts as (
              select g.id gw_id, ts.team_id, count(f.id) n
              from public.gameweeks g
              join public.team_seasons ts on ts.season_id = g.season_id
              left join public.fixtures f on f.gameweek_id = g.id
                and (f.home_team_id = ts.team_id or f.away_team_id = ts.team_id)
              where g.season_id = :s
              group by g.id, ts.team_id
            )
            update public.gameweeks g set is_blank = c.blank, is_double = c.dbl
            from (select gw_id, bool_or(n = 0) blank, bool_or(n >= 2) dbl from counts group by gw_id) c
            where g.id = c.gw_id
            """
        ),
        {"s": sid},
    )
    return {
        "season": label,
        "teams": len(team_map),
        "players": len(known_players),
        "gameweeks": len(deadlines),
        "fixtures": len(valid_fx),
        "fixtures_reconstructed": not bool(files["fixtures.csv"]),
        "gw_rows": len(params),
        "gw_rows_skipped": skipped,
    }


GW_UPSERT = text(
    """
    insert into public.player_fpl_gw_stats
      (player_id, fixture_id, gameweek_id, minutes, total_points, bonus, bps, goals_scored, assists,
       clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed, yellow_cards,
       red_cards, saves, defensive_contribution, expected_goals, expected_assists,
       expected_goal_involvements, expected_goals_conceded, influence, creativity, threat, ict_index,
       value_tenths, selected, is_final, team_id, opponent_team_id, was_home, starts, fpl_xp,
       transfers_in, transfers_out, transfers_balance, source, extra)
    values
      (:pid, :fx, :gw, :minutes, :total_points, :bonus, :bps, :goals_scored, :assists,
       :clean_sheets, :goals_conceded, :own_goals, :penalties_saved, :penalties_missed, :yellow_cards,
       :red_cards, :saves, :defensive_contribution, :expected_goals, :expected_assists,
       :expected_goal_involvements, :expected_goals_conceded, :influence, :creativity, :threat,
       :ict_index, :value_tenths, :selected, true, :team, :opp, :home, :starts, :fpl_xp,
       :transfers_in, :transfers_out, :transfers_balance, 'vaastav', cast(:extra as jsonb))
    on conflict (player_id, fixture_id) do update set
      minutes = excluded.minutes, total_points = excluded.total_points, bonus = excluded.bonus,
      bps = excluded.bps, goals_scored = excluded.goals_scored, assists = excluded.assists,
      clean_sheets = excluded.clean_sheets, goals_conceded = excluded.goals_conceded,
      own_goals = excluded.own_goals, penalties_saved = excluded.penalties_saved,
      penalties_missed = excluded.penalties_missed, yellow_cards = excluded.yellow_cards,
      red_cards = excluded.red_cards, saves = excluded.saves,
      defensive_contribution = excluded.defensive_contribution,
      expected_goals = excluded.expected_goals, expected_assists = excluded.expected_assists,
      expected_goal_involvements = excluded.expected_goal_involvements,
      expected_goals_conceded = excluded.expected_goals_conceded, influence = excluded.influence,
      creativity = excluded.creativity, threat = excluded.threat, ict_index = excluded.ict_index,
      value_tenths = excluded.value_tenths, selected = excluded.selected, is_final = true,
      team_id = excluded.team_id, opponent_team_id = excluded.opponent_team_id,
      was_home = excluded.was_home, starts = excluded.starts, fpl_xp = excluded.fpl_xp,
      transfers_in = excluded.transfers_in, transfers_out = excluded.transfers_out,
      transfers_balance = excluded.transfers_balance, source = excluded.source, extra = excluded.extra
    """
)


@job("backfill_history")
def backfill_history(seasons: str | None = None) -> dict[str, Any]:
    engine = get_engine()
    with engine.connect() as conn:
        current = conn.execute(text("select label from public.seasons where is_current")).scalar()
    if current is None:
        raise JobSkipped("belum ada musim berjalan — jalankan seed")
    folders = seasons.split(",") if seasons else v.past_season_folders(current)

    results = []
    with httpx.Client(base_url=v.BASE_URL, timeout=120, follow_redirects=True) as client:
        master_csv = _get(client, "master_team_list.csv") or ""
        with engine.begin() as conn:
            archive_bytes(
                conn,
                source="vaastav",
                endpoint="data/master_team_list.csv",
                raw=master_csv.encode("utf-8"),
                ext="csv",
                reason="backfill",
                season_label=None,
            )
        for folder in folders:
            started = datetime.now(UTC)
            files = fetch_season(client, folder)
            with engine.begin() as conn:
                archived = _archive_files(conn, folder, files)
            with engine.begin() as conn:
                res = apply_season(conn, folder, files, master_csv)
            res["archived_files"] = archived
            res["seconds"] = round((datetime.now(UTC) - started).total_seconds(), 1)
            log.info("backfill.season_done", **res)
            results.append(res)
    return {"seasons": results}
