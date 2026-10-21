"""evaluate_model: akurasi xPts v1 per GW selesai (backtest point-in-time) vs baseline (BLUEPRINT 5.5).

Untuk tiap GW selesai musim berjalan: rate & rating dihitung HANYA dari data sebelum deadline GW itu,
diproyeksikan ke laga GW itu, lalu dibandingkan dengan poin aktual. Baseline = rata-rata poin pemain
di 4 laga timnya terakhir. Hasil → public.model_evaluations (permanen, kecil).
"""

import json
import math
from collections import defaultdict
from typing import Any

from sqlalchemy import text

from app.db import get_engine
from app.jobs.sync_bootstrap import current_season_id
from app.models import engine as v1
from app.scheduler.runner import job

BACKTEST_VERSION = "xpts-v1-backtest"
BASELINE_VERSION = "baseline-last4"


def _ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2.0
        i = j + 1
    return ranks


def spearman(a: list[float], b: list[float]) -> float:
    if len(a) < 3:
        return 0.0
    ra, rb = _ranks(a), _ranks(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb, strict=True))
    va = math.sqrt(sum((x - ma) ** 2 for x in ra))
    vb = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return cov / (va * vb) if va and vb else 0.0


def metrics(pred: list[float], actual: list[float]) -> dict[str, float]:
    n = len(pred)
    err = [p - a for p, a in zip(pred, actual, strict=True)]
    top = sorted(range(n), key=lambda i: pred[i], reverse=True)[:10]
    best = sorted(actual, reverse=True)[:10]
    return {
        "mae_xpts": sum(abs(e) for e in err) / n,
        "rmse_xpts": math.sqrt(sum(e * e for e in err) / n),
        "bias_xpts": sum(err) / n,
        "spearman": spearman(pred, actual),
        "top10_actual_avg": sum(actual[i] for i in top) / max(1, len(top)),
        "top10_best_avg": sum(best) / max(1, len(best)),
        "n_players": float(n),
    }


@job("evaluate_model")
def evaluate_model(min_gw: int = 3) -> dict[str, Any]:
    engine = get_engine()
    results: dict[int, dict[str, Any]] = {}
    with engine.connect() as conn:
        season_id = current_season_id(conn)
        players = conn.execute(
            text(
                "select player_id, team_id, fpl_position from public.player_seasons "
                "where season_id = :s and left_on is null and fpl_position is not null"
            ),
            {"s": season_id},
        ).all()
        positions = {int(p.player_id): p.fpl_position for p in players}
        team_of = {int(p.player_id): int(p.team_id) for p in players}
        gws = conn.execute(
            text(
                "select id, number, deadline_utc from public.gameweeks "
                "where season_id = :s and is_finished and number >= :m order by number"
            ),
            {"s": season_id, "m": int(min_gw)},
        ).all()
        for g in gws:
            ctx = v1.build_context(conn, g.deadline_utc, season_id, positions)
            fixtures = conn.execute(
                text("select home_team_id, away_team_id from public.fixtures where gameweek_id = :g"),
                {"g": g.id},
            ).all()
            opps: dict[int, list[tuple[int, bool]]] = defaultdict(list)
            for f in fixtures:
                opps[int(f.home_team_id)].append((int(f.away_team_id), True))
                opps[int(f.away_team_id)].append((int(f.home_team_id), False))
            actual = {
                int(r.player_id): (int(r.pts or 0), int(r.mins or 0))
                for r in conn.execute(
                    text(
                        "select player_id, sum(total_points) pts, sum(minutes) mins "
                        "from public.player_fpl_gw_stats "
                        "where gameweek_id = :g group by player_id"
                    ),
                    {"g": g.id},
                )
            }
            baseline = {
                int(r.player_id): float(r.avg_pts)
                for r in conn.execute(
                    text(
                        """
                        with r as (
                          select s.player_id, s.total_points,
                                 row_number() over (partition by s.player_id order by f.kickoff_utc desc) rn
                          from public.player_fpl_gw_stats s join public.fixtures f on f.id = s.fixture_id
                          where f.season_id = :s and f.status = 'finished' and f.kickoff_utc < :d
                        )
                        select player_id, avg(total_points) avg_pts from r where rn <= 4 group by player_id
                        """
                    ),
                    {"s": season_id, "d": g.deadline_utc},
                )
            }
            pred, base, act = [], [], []
            for pid, pos in positions.items():
                x = sum(
                    v1.project(ctx, pid, pos, team_of[pid], opp, home)["xpts"]
                    for opp, home in opps.get(team_of[pid], [])
                )
                pts, mins = actual.get(pid, (0, 0))
                if x <= 0.05 and mins == 0:
                    continue  # pemain yang tidak diproyeksikan main dan memang tidak main
                pred.append(x)
                base.append(baseline.get(pid, 0.0))
                act.append(float(pts))
            if len(pred) < 20:
                continue
            results[int(g.number)] = {
                BACKTEST_VERSION: metrics(pred, act),
                BASELINE_VERSION: metrics(base, act),
                "gw_id": int(g.id),
            }

    with engine.begin() as conn:
        for _gw, res in results.items():
            for version in (BACKTEST_VERSION, BASELINE_VERSION):
                for metric, value in res[version].items():
                    conn.execute(
                        text(
                            """
                            insert into public.model_evaluations
                              (gameweek_id, model_version, metric, value, detail)
                            values (:g, :v, :m, :val, cast(:d as jsonb))
                            on conflict (gameweek_id, model_version, metric) do update
                              set value = excluded.value, detail = excluded.detail, created_at = now()
                            """
                        ),
                        {"g": res["gw_id"], "v": version, "m": metric, "val": value, "d": json.dumps({})},
                    )
    return {
        "gws": sorted(results),
        "mae_v1": {gw: round(r[BACKTEST_VERSION]["mae_xpts"], 3) for gw, r in results.items()},
        "mae_baseline": {gw: round(r[BASELINE_VERSION]["mae_xpts"], 3) for gw, r in results.items()},
    }
