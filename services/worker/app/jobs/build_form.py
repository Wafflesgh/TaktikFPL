"""build_form: player_fpl_gw_stats → player_form_features (last4, last8, season + label form)."""

import json
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from app.db import get_engine
from app.features.form import MatchLine, build_player_form
from app.jobs.sync_bootstrap import current_season_id
from app.scheduler.runner import JobSkipped, job


@job("build_form")
def build_form() -> dict[str, Any]:
    engine = get_engine()
    with engine.connect() as conn:
        season_id = current_season_id(conn)
        rows = conn.execute(
            text(
                """
                select s.player_id, ps.fpl_position, f.kickoff_utc, s.minutes, s.total_points,
                       s.goals_scored, s.assists, s.bonus, s.expected_goals, s.expected_assists,
                       s.defensive_contribution, s.clean_sheets
                from public.player_fpl_gw_stats s
                join public.fixtures f on f.id = s.fixture_id and f.season_id = :s
                join public.player_seasons ps
                  on ps.player_id = s.player_id and ps.season_id = :s and ps.left_on is null
                where f.status = 'finished' and f.kickoff_utc is not null
                order by s.player_id, f.kickoff_utc
                """
            ),
            {"s": season_id},
        ).all()
    if not rows:
        raise JobSkipped("player_fpl_gw_stats kosong — jalankan sync_player_history dulu")

    matches: dict[int, list[MatchLine]] = defaultdict(list)
    positions: dict[int, str] = {}
    for r in rows:
        positions[int(r.player_id)] = r.fpl_position
        matches[int(r.player_id)].append(
            MatchLine(
                kickoff_ts=r.kickoff_utc.timestamp(),
                minutes=r.minutes or 0,
                total_points=r.total_points or 0,
                goals=r.goals_scored or 0,
                assists=r.assists or 0,
                bonus=r.bonus or 0,
                xg=float(r.expected_goals or 0),
                xa=float(r.expected_assists or 0),
                defcon=r.defensive_contribution or 0,
                clean_sheet=r.clean_sheets or 0,
            )
        )

    forms = build_player_form(matches, positions)
    as_of = datetime.now(UTC)
    params = [
        {
            "pid": pid,
            "as_of": as_of,
            "w": window,
            "m": json.dumps(metrics),
            "min": int(metrics["minutes"]),
        }
        for pid, windows in forms.items()
        for window, metrics in windows.items()
    ]
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                insert into public.player_form_features
                  (player_id, as_of, window_label, metrics, sample_minutes)
                values (:pid, :as_of, :w, cast(:m as jsonb), :min)
                """
            ),
            params,
        )
    labels: dict[str, int] = defaultdict(int)
    for windows in forms.values():
        labels[windows["last4"]["form_label"]] += 1
    return {"players": len(forms), "rows": len(params), "labels": dict(labels)}
