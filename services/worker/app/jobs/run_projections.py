"""run_projections: xPts v0 untuk 6 GW ke depan → projections + squad optimal (wildcard).

Retensi (paket gratis, ADR 0001): run harian/adhoc hanya 3 terbaru disimpan utuh; run 't60'
(titik keputusan sebelum deadline) disimpan permanen tetapi dipangkas ke laga GW-nya sendiri
begitu ada run yang lebih baru — cukup untuk evaluasi model & training (point-in-time).
"""

import json
from collections import defaultdict
from typing import Any

from sqlalchemy import text

from app.db import get_engine
from app.jobs.sync_bootstrap import current_season_id
from app.models.xpts_v0 import MODEL_VERSION, FixtureCtx, PlayerForm, project
from app.optimize.squad import Candidate, optimize_squad
from app.scheduler.runner import JobSkipped, job

HORIZON_GW = 6
DISCOUNT = 0.85  # bobot per GW ke depan (BLUEPRINT 5.4)
KEEP_RECENT_RUNS = 3
RUN_TYPES = {"weekly", "t48", "t24", "t6", "t2", "t60", "t15", "adhoc", "backtest"}


def horizon_value(xpts_by_gw: dict[int, float], first_gw: int) -> float:
    """Total xPts terdiskon: GW pertama bobot 1, berikutnya ×0.85 per GW."""
    return sum(x * DISCOUNT ** (gw - first_gw) for gw, x in xpts_by_gw.items())


def _f(m: dict[str, Any] | None, key: str) -> float | None:
    if not m or m.get(key) is None:
        return None
    return float(m[key])


@job("run_projections")
def run_projections(run_type: str = "adhoc") -> dict[str, Any]:
    if run_type not in RUN_TYPES:
        run_type = "adhoc"
    engine = get_engine()
    with engine.connect() as conn:
        season_id = current_season_id(conn)
        nxt = conn.execute(
            text("select id, number from public.gameweeks where season_id = :s and is_next"), {"s": season_id}
        ).first()
        if nxt is None:
            raise JobSkipped("tidak ada GW berikutnya (akhir musim?)")
        first_gw = int(nxt.number)
        gws = {
            int(r.number): int(r.id)
            for r in conn.execute(
                text(
                    "select id, number from public.gameweeks where season_id = :s "
                    "and number between :a and :b"
                ),
                {"s": season_id, "a": first_gw, "b": first_gw + HORIZON_GW - 1},
            )
        }
        gw_number_by_id = {v: k for k, v in gws.items()}
        fixtures = conn.execute(
            text(
                """
                select id, gameweek_id, home_team_id, away_team_id, difficulty_home, difficulty_away
                from public.fixtures
                where gameweek_id = any(:g) and status not in ('postponed','cancelled','abandoned')
                """
            ),
            {"g": list(gws.values())},
        ).all()
        players = conn.execute(
            text(
                """
                select id, team_id, fpl_position, status, chance_next, price_tenths
                from public.v_player_current
                """
            )
        ).all()
        forms: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
        for r in conn.execute(
            text(
                """
                select distinct on (player_id, window_label) player_id, window_label, metrics
                from public.player_form_features
                order by player_id, window_label, as_of desc
                """
            )
        ):
            forms[int(r.player_id)][r.window_label] = r.metrics

    by_team: dict[int, list[Any]] = defaultdict(list)
    for fx in fixtures:
        by_team[int(fx.home_team_id)].append((fx, True))
        by_team[int(fx.away_team_id)].append((fx, False))

    rows: list[dict[str, Any]] = []
    per_gw: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for p in players:
        f = forms.get(int(p.id), {})
        form = PlayerForm(
            points90_last4=_f(f.get("last4"), "points90_shrunk"),
            points90_season=_f(f.get("season"), "points90_shrunk"),
            minutes_share_last4=_f(f.get("last4"), "minutes_share"),
            minutes_share_last8=_f(f.get("last8"), "minutes_share"),
            status=p.status,
            chance_next=p.chance_next,
        )
        for fx, is_home in by_team.get(int(p.team_id), []):
            gw = gw_number_by_id[int(fx.gameweek_id)]
            # chance_of_playing hanya relevan untuk GW terdekat; GW berikutnya pakai status saja.
            ctx_form = form if gw == first_gw else PlayerForm(**{**form.__dict__, "chance_next": None})
            out = project(
                ctx_form,
                FixtureCtx(fdr=fx.difficulty_home if is_home else fx.difficulty_away, is_home=is_home),
            )
            per_gw[int(p.id)][gw] += out["xpts"]
            rows.append(
                {
                    "pid": int(p.id),
                    "fx": int(fx.id),
                    "xmins": out["xmins"],
                    "xpts": out["xpts"],
                    "breakdown": json.dumps({**out, "gw": gw, "home": is_home}),
                }
            )

    # Squad optimal dari nol (budget £100.0m) memakai nilai horizon terdiskon.
    info = {int(p.id): p for p in players}
    candidates = [
        Candidate(
            player_id=pid,
            position=info[pid].fpl_position,
            team_id=int(info[pid].team_id),
            price_tenths=int(info[pid].price_tenths or 0),
            value=round(horizon_value(gwx, first_gw), 3),
        )
        for pid, gwx in per_gw.items()
        if info[pid].fpl_position and info[pid].price_tenths
    ]
    plan = optimize_squad(candidates)

    with engine.begin() as conn:
        run_id = conn.execute(
            text(
                """
                insert into public.model_runs (gameweek_id, run_type, model_version, status, notes)
                values (:g, :t, :v, 'running', cast(:n as jsonb)) returning id
                """
            ),
            {
                "g": gws[first_gw],
                "t": run_type,
                "v": MODEL_VERSION,
                "n": json.dumps({"horizon_gw": HORIZON_GW, "discount": DISCOUNT, "first_gw": first_gw}),
            },
        ).scalar_one()
        if rows:
            conn.execute(
                text(
                    """
                    insert into public.projections
                      (model_run_id, player_id, fixture_id, xmins, xpts, component_breakdown)
                    values (:r, :pid, :fx, :xmins, :xpts, cast(:breakdown as jsonb))
                    """
                ),
                [{**r, "r": run_id} for r in rows],
            )
        conn.execute(
            text(
                """
                insert into public.analysis_reports
                  (gameweek_id, model_run_id, report_type, status, title, content_json)
                values (:g, :r, 'weekly_draft', :st, :title, cast(:c as jsonb))
                """
            ),
            {
                "g": gws[first_gw],
                "r": run_id,
                "st": "ok" if plan.status == "Optimal" else "degraded",
                "title": f"Squad optimal GW{first_gw}–{first_gw + HORIZON_GW - 1} (wildcard)",
                "c": json.dumps(
                    {
                        "kind": "optimal_squad",
                        "squad": plan.squad,
                        "starters": plan.starters,
                        "captain": plan.captain,
                        "cost_tenths": plan.cost_tenths,
                        "value_xi": plan.value_xi,
                        "solver_status": plan.status,
                        "horizon_gw": HORIZON_GW,
                        "discount": DISCOUNT,
                        "first_gw": first_gw,
                        "model_version": MODEL_VERSION,
                    }
                ),
            },
        )
        conn.execute(
            text("update public.model_runs set status = 'ok', finished_at = now() where id = :r"),
            {"r": run_id},
        )
        # Retensi: hapus run lama non-t60 (cascade ke projections), pangkas t60 lama ke GW-nya sendiri.
        old = [
            int(i)
            for (i,) in conn.execute(
                text(
                    """
                    select id from public.model_runs
                    where run_type <> 't60' and id <> :r
                      and id not in (select id from public.model_runs where run_type <> 't60'
                                     order by id desc limit :k)
                    """
                ),
                {"r": run_id, "k": KEEP_RECENT_RUNS},
            )
        ]
        if old:
            conn.execute(text("delete from public.analysis_reports where model_run_id = any(:o)"), {"o": old})
            conn.execute(text("delete from public.model_runs where id = any(:o)"), {"o": old})
        pruned = len(old)
        trimmed = conn.execute(
            text(
                """
                delete from public.projections p
                using public.model_runs r, public.fixtures f
                where p.model_run_id = r.id and r.run_type = 't60' and r.id <> :r
                  and f.id = p.fixture_id and f.gameweek_id is distinct from r.gameweek_id
                """
            ),
            {"r": run_id},
        ).rowcount

    return {
        "model_run_id": run_id,
        "first_gw": first_gw,
        "projections": len(rows),
        "players": len(per_gw),
        "squad_status": plan.status,
        "squad_cost": plan.cost_tenths / 10,
        "squad_value_xi": plan.value_xi,
        "runs_pruned": pruned,
        "t60_rows_trimmed": trimmed,
    }
