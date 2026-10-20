"""sync_player_history: element-summary/{id} → player_fpl_gw_stats (BLUEPRINT 9.1, harian 05:00 UTC).

Semua pemain aktif musim ini diambil dengan throttle FPL_REQUESTS_PER_SECOND (±11 menit untuk
±670 pemain pada 1 req/detik). Payload sukses tidak disimpan ke raw_payloads (lihat CHANGELOG).
"""

from typing import Any

import structlog
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine
from app.jobs.sync_bootstrap import current_season_id
from app.scheduler.runner import job
from app.sources.base import SourceHTTPError
from app.sources.fpl import FPLClient, HistoryRow, parse_history

log = structlog.get_logger()

UPSERT_SQL = text(
    """
    insert into public.player_fpl_gw_stats
      (player_id, fixture_id, gameweek_id, minutes, total_points, bonus, bps, goals_scored, assists,
       clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed, yellow_cards,
       red_cards, saves, defensive_contribution, expected_goals, expected_assists,
       expected_goal_involvements, expected_goals_conceded, influence, creativity, threat, ict_index,
       value_tenths, selected, is_final, team_id, opponent_team_id, was_home, starts,
       transfers_in, transfers_out, transfers_balance, source)
    values
      (:pid, :fx, :gw, :minutes, :total_points, :bonus, :bps, :goals_scored, :assists,
       :clean_sheets, :goals_conceded, :own_goals, :penalties_saved, :penalties_missed, :yellow_cards,
       :red_cards, :saves, :defensive_contribution, :expected_goals, :expected_assists,
       :expected_goal_involvements, :expected_goals_conceded, :influence, :creativity, :threat,
       :ict_index, :value_tenths, :selected, :is_final, :team, :opp, :home, :starts,
       :transfers_in, :transfers_out, :transfers_balance, 'fpl_api')
    on conflict (player_id, fixture_id) do update set
      gameweek_id = excluded.gameweek_id, minutes = excluded.minutes,
      total_points = excluded.total_points, bonus = excluded.bonus, bps = excluded.bps,
      goals_scored = excluded.goals_scored, assists = excluded.assists,
      clean_sheets = excluded.clean_sheets, goals_conceded = excluded.goals_conceded,
      own_goals = excluded.own_goals, penalties_saved = excluded.penalties_saved,
      penalties_missed = excluded.penalties_missed, yellow_cards = excluded.yellow_cards,
      red_cards = excluded.red_cards, saves = excluded.saves,
      defensive_contribution = excluded.defensive_contribution,
      expected_goals = excluded.expected_goals, expected_assists = excluded.expected_assists,
      expected_goal_involvements = excluded.expected_goal_involvements,
      expected_goals_conceded = excluded.expected_goals_conceded,
      influence = excluded.influence, creativity = excluded.creativity, threat = excluded.threat,
      ict_index = excluded.ict_index, value_tenths = excluded.value_tenths,
      selected = excluded.selected, is_final = excluded.is_final,
      team_id = excluded.team_id, opponent_team_id = excluded.opponent_team_id,
      was_home = excluded.was_home, starts = excluded.starts,
      transfers_in = excluded.transfers_in, transfers_out = excluded.transfers_out,
      transfers_balance = excluded.transfers_balance
    where public.player_fpl_gw_stats.is_final is distinct from true
       or public.player_fpl_gw_stats.total_points is distinct from excluded.total_points
    """
)


def history_params(
    player_id: int,
    rows: list[HistoryRow],
    fixture_by_fpl: dict[int, tuple[int, int, int]],
    gw_by_number: dict[int, tuple[int, bool]],
) -> list[dict[str, Any]]:
    params = []
    for h in rows:
        fx = fixture_by_fpl.get(h.fpl_fixture_id)
        gw = gw_by_number.get(h.round)
        if fx is None or gw is None:
            continue
        fixture_id, home_team, away_team = fx
        if h.was_home is None:
            own = opp = None
        else:
            own, opp = (home_team, away_team) if h.was_home else (away_team, home_team)
        gw_id, gw_final = gw
        params.append(
            {
                "pid": player_id,
                "fx": fixture_id,
                "gw": gw_id,
                "minutes": h.minutes,
                "total_points": h.total_points,
                "bonus": h.bonus,
                "bps": h.bps,
                "goals_scored": h.goals_scored,
                "assists": h.assists,
                "clean_sheets": h.clean_sheets,
                "goals_conceded": h.goals_conceded,
                "own_goals": h.own_goals,
                "penalties_saved": h.penalties_saved,
                "penalties_missed": h.penalties_missed,
                "yellow_cards": h.yellow_cards,
                "red_cards": h.red_cards,
                "saves": h.saves,
                "defensive_contribution": h.defensive_contribution,
                "expected_goals": h.expected_goals,
                "expected_assists": h.expected_assists,
                "expected_goal_involvements": h.expected_goal_involvements,
                "expected_goals_conceded": h.expected_goals_conceded,
                "influence": h.influence,
                "creativity": h.creativity,
                "threat": h.threat,
                "ict_index": h.ict_index,
                "value_tenths": h.value_tenths,
                "selected": h.selected,
                "is_final": gw_final,
                "team": own,
                "opp": opp,
                "home": h.was_home,
                "starts": h.starts,
                "transfers_in": h.transfers_in,
                "transfers_out": h.transfers_out,
                "transfers_balance": h.transfers_balance,
            }
        )
    return params


@job("sync_player_history")
def sync_player_history(limit: int | None = None) -> dict[str, Any]:
    settings = get_settings()
    engine = get_engine()
    with engine.connect() as conn:
        season_id = current_season_id(conn)
        targets = conn.execute(
            text(
                """
                select ps.player_id, ps.fpl_element_id
                from public.player_seasons ps
                where ps.season_id = :s and ps.left_on is null and ps.fpl_element_id is not null
                order by ps.fpl_element_id
                """
            ),
            {"s": season_id},
        ).all()
        fixture_by_fpl = {
            int(r.fpl_fixture_id): (int(r.id), int(r.home_team_id), int(r.away_team_id))
            for r in conn.execute(
                text(
                    "select id, fpl_fixture_id, home_team_id, away_team_id from public.fixtures "
                    "where season_id = :s and fpl_fixture_id is not null"
                ),
                {"s": season_id},
            )
        }
        gw_by_number = {
            int(r.number): (int(r.id), r.scores_final_at is not None)
            for r in conn.execute(
                text("select id, number, scores_final_at from public.gameweeks where season_id = :s"),
                {"s": season_id},
            )
        }
    if limit:
        targets = targets[:limit]

    fetched = rows_written = errors = 0
    with FPLClient(settings.fpl_base_url, settings.fpl_requests_per_second, engine) as fpl:
        for t in targets:
            try:
                summary = fpl.element_summary(int(t.fpl_element_id), store_raw=False)
            except SourceHTTPError as exc:
                errors += 1
                log.warning("player_history.fetch_failed", element=t.fpl_element_id, error=str(exc))
                continue
            fetched += 1
            params = history_params(int(t.player_id), parse_history(summary), fixture_by_fpl, gw_by_number)
            if params:
                with engine.begin() as conn:
                    conn.execute(UPSERT_SQL, params)
                rows_written += len(params)
    return {"players": len(targets), "fetched": fetched, "rows": rows_written, "errors": errors}
