"""run_projections: xPts v1 (fallback v0 bila aturan poin belum ada) untuk 6 GW ke depan
→ projections + squad optimal (wildcard).

Retensi (paket gratis, ADR 0001): run harian/adhoc hanya 3 terbaru disimpan utuh; run 't60'
(titik keputusan sebelum deadline) disimpan permanen tetapi dipangkas ke laga GW-nya sendiri
begitu ada run yang lebih baru — cukup untuk evaluasi model & training (point-in-time).
"""

import json
from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db import get_engine
from app.jobs.sync_bootstrap import current_season_id
from app.lab.live import DEFAULT_MODEL, live_predictions, resolve_active
from app.models import engine as v1
from app.models import xpts_v0
from app.models.reasons import FixtureView, player_reasons
from app.models.xpts_v0 import FixtureCtx, PlayerForm
from app.optimize.season import SeasonInput, plan_season
from app.optimize.squad import Candidate, best_xi, optimize_squad
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


SEASON_PLAN_EVERY = timedelta(hours=6)


def _season_plan(
    engine: Engine,
    season_id: int,
    gws: dict[int, int],
    first_gw: int,
    fixtures: Sequence[Any],
    players: Sequence[Any],
    season_xpts: dict[int, dict[int, float]],
    team_short: dict[int, str],
    template: list[int],
) -> dict[str, Any]:
    """Rencana musim & chip → laporan 'season_plan'.

    Satu snapshot permanen per GW (patokan mingguan), diperbarui paling sering tiap 6 jam.
    """
    with engine.connect() as conn:
        if not conn.execute(text("select to_regclass('public.fpl_chips') is not null")).scalar_one():
            return {"skipped": "migrasi season_plan belum diterapkan"}
        last = conn.execute(
            text(
                "select max(created_at) from public.analysis_reports "
                "where report_type = 'season_plan' and gameweek_id = :g"
            ),
            {"g": gws[first_gw]},
        ).scalar_one()
        if last is not None and datetime.now(UTC) - last < SEASON_PLAN_EVERY:
            return {"skipped": "baru dibuat"}
        chips = [
            dict(r._mapping)
            for r in conn.execute(
                text(
                    "select name, number, start_event, stop_event from public.fpl_chips where season_id = :s"
                ),
                {"s": season_id},
            )
        ]
        settings = {
            r.key: r.value
            for r in conn.execute(
                text("select key, value from public.fpl_game_settings where season_id = :s"), {"s": season_id}
            )
        }
    gw_of = {v: k for k, v in gws.items()}
    per_team: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for fx in fixtures:
        g = gw_of[int(fx.gameweek_id)]
        per_team[g][int(fx.home_team_id)] += 1
        per_team[g][int(fx.away_team_id)] += 1
    info = {int(p.id): p for p in players if p.fpl_position}
    inp = SeasonInput(
        first_gw=first_gw,
        last_gw=max(gws),
        xpts={pid: dict(v) for pid, v in season_xpts.items() if pid in info},
        position={pid: p.fpl_position for pid, p in info.items()},
        team={pid: int(p.team_id) for pid, p in info.items()},
        price={pid: int(p.price_tenths or 0) for pid, p in info.items()},
        name={pid: n for pid, n in _names(engine, list(info)).items()},
        team_short=team_short,
        fixtures_per_team={g: dict(t) for g, t in per_team.items()},
        template=template,
        chips=chips,
        budget_tenths=int(settings.get("squad_total_spend") or 1000),
        max_per_team=int(settings.get("squad_team_limit") or 3),
    )
    content = {"kind": "season_plan", **plan_season(inp), "settings": settings}
    with engine.begin() as conn:
        conn.execute(
            text(
                "delete from public.analysis_reports where report_type = 'season_plan' and gameweek_id = :g"
            ),
            {"g": gws[first_gw]},
        )
        conn.execute(
            text(
                """
                insert into public.analysis_reports (gameweek_id, report_type, status, title, content_json)
                values (:g, 'season_plan', 'ok', :t, cast(:c as jsonb))
                """
            ),
            {"g": gws[first_gw], "t": f"Season plan from GW{first_gw}", "c": json.dumps(content)},
        )
    return {
        "gws": len(content["gws"]),
        "chips": {c["label"] + str(c["start_event"]): c["recommended_gw"] for c in content["chips"]},
    }


def _names(engine: Engine, ids: list[int]) -> dict[int, str]:
    with engine.connect() as conn:
        return {
            int(r.id): r.web_name
            for r in conn.execute(
                text("select id, web_name from public.players where id = any(:i)"), {"i": ids}
            )
        }


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
        horizon_last = (
            first_gw + HORIZON_GW - 1
        )  # proyeksi rinci & squad; GW sesudahnya hanya untuk rencana musim
        gws = {
            int(r.number): int(r.id)
            for r in conn.execute(
                text("select id, number from public.gameweeks where season_id = :s and number >= :a"),
                {"s": season_id, "a": first_gw},
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
                select id, team_id, fpl_position, status, chance_next, news, price_tenths
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
        team_short = {
            int(t.id): t.short_name or "?"
            for t in conn.execute(text("select id, short_name from public.teams"))
        }
        positions = {int(p.id): p.fpl_position for p in players if p.fpl_position}
        ctx = v1.build_context(conn, datetime.now(UTC), season_id, positions)
    use_v1 = bool(ctx.rules.get("goals_scored_MID"))  # aturan poin dari bootstrap sudah tersimpan
    model_version = v1.MODEL_VERSION if use_v1 else xpts_v0.MODEL_VERSION

    by_team: dict[int, list[Any]] = defaultdict(list)
    for fx in fixtures:
        by_team[int(fx.home_team_id)].append((fx, True))
        by_team[int(fx.away_team_id)].append((fx, False))

    rows: list[dict[str, Any]] = []
    per_gw: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    season_xpts: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    views: dict[int, list[FixtureView]] = defaultdict(list)
    first_row: dict[int, int] = {}  # pemain → indeks baris laga pertamanya di GW terdekat (tempat alasan)
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
            if use_v1:
                opp = int(fx.away_team_id if is_home else fx.home_team_id)
                play = v1.p_play(p.status, p.chance_next if gw == first_gw else None)
                out = v1.project(ctx, int(p.id), p.fpl_position, int(p.team_id), opp, is_home, play)
            else:
                ctx_form = form if gw == first_gw else PlayerForm(**{**form.__dict__, "chance_next": None})
                fdr = fx.difficulty_home if is_home else fx.difficulty_away
                out = xpts_v0.project(ctx_form, FixtureCtx(fdr=fdr, is_home=is_home))
            season_xpts[int(p.id)][gw] += out["xpts"]
            if gw > horizon_last:
                continue
            per_gw[int(p.id)][gw] += out["xpts"]
            if use_v1:
                views[int(p.id)].append(
                    FixtureView(
                        gw,
                        team_short.get(opp, "?"),
                        is_home,
                        out["xmins"],
                        out["att_mult"],
                        out["team_cs"],
                        out["xg"] + out["xa"],
                        out["c_defcon"],
                        out["xg"],
                        out["xa"],
                        out["p60"],
                        out["p_goal"],
                        out["p_assist"],
                        out["p_defcon"],
                        out["lam_team"],
                        out.get("opp_style"),
                        out.get("opp_ppda"),
                        out.get("opp_rank_passive"),
                        out.get("opp_n_teams"),
                    )
                )
                if gw == first_gw:
                    first_row.setdefault(int(p.id), len(rows))
            rows.append(
                {
                    "pid": int(p.id),
                    "fx": int(fx.id),
                    "xmins": out["xmins"],
                    "xpts": out["xpts"],
                    "breakdown": {**out, "gw": gw, "home": is_home},
                }
            )

    # Alasan pemilihan (form, lawan, menit, cedera) — disimpan di baris laga pertama GW terdekat.
    for p in players:
        idx = first_row.get(int(p.id))
        if idx is None or not p.fpl_position:
            continue
        rows[idx]["breakdown"]["reasons"] = player_reasons(
            p.fpl_position,
            p.status,
            p.chance_next,
            p.news,
            forms.get(int(p.id), {}).get("last4"),
            views[int(p.id)],
            first_gw,
            tac.to_json() if (tac := ctx.tactics.get(int(p.id))) else None,
        )
    # Model aktif dari Model Lab: xPts per GW diganti prediksi model itu (dibagi ke laga sesuai porsi v1,
    # dikali peluang main dari status FPL). Komponen & alasan v1 tetap disimpan sebagai penjelasan.
    with engine.connect() as conn:
        active, active_info = resolve_active(conn)
        lab_preds = (
            live_predictions(conn, season_id, first_gw, HORIZON_GW, active)
            if use_v1 and active != DEFAULT_MODEL
            else None
        )
    if lab_preds:
        status = {int(p.id): (p.status, p.chance_next) for p in players}
        n_rows: dict[tuple[int, int], int] = defaultdict(int)
        for row in rows:
            n_rows[(row["pid"], row["breakdown"]["gw"])] += 1
        new_gw: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
        for row in rows:
            pid, gw = row["pid"], row["breakdown"]["gw"]
            st, ch = status.get(pid, (None, None))
            target = lab_preds.get(pid, {}).get(gw, 0.0) * v1.p_play(st, ch if gw == first_gw else None)
            v1_total = per_gw[pid].get(gw, 0.0)
            new = row["xpts"] * target / v1_total if v1_total > 0 else target / n_rows[(pid, gw)]
            row["breakdown"].update(v1_xpts=row["xpts"], model=active)
            row["xpts"] = round(new, 3)
            new_gw[pid][gw] += row["xpts"]
        per_gw = new_gw
        model_version = f"lab:{active}"
    for row in rows:
        row["breakdown"] = json.dumps(row["breakdown"])

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
    # Squad terbaik untuk GW terdekat saja (budget £100.0m, XI + cadangan) — panel "Best XI" di Home.
    xi = best_xi(
        [
            Candidate(
                c.player_id,
                c.position,
                c.team_id,
                c.price_tenths,
                round(per_gw[c.player_id].get(first_gw, 0.0), 3),
            )
            for c in candidates
        ]
    )

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
                "v": model_version,
                "n": json.dumps(
                    {
                        "horizon_gw": HORIZON_GW,
                        "discount": DISCOUNT,
                        "first_gw": first_gw,
                        "active_model": active,
                        "active_info": active_info,
                    }
                ),
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
                        "model_version": model_version,
                        "best_xi": {
                            "gw": first_gw,
                            "starters": xi.starters,
                            "bench": xi.bench,
                            "cost_tenths": xi.cost_tenths,
                            "captain": xi.captain,
                            "vice": xi.vice,
                            "formation": xi.formation,
                            "xpts": xi.value,
                            "solver_status": xi.status,
                        },
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

    season = _season_plan(
        engine, season_id, gws, first_gw, fixtures, players, season_xpts, team_short, plan.squad
    )

    return {
        "season_plan": season,
        "model_run_id": run_id,
        "active_model": active,
        "first_gw": first_gw,
        "projections": len(rows),
        "players": len(per_gw),
        "squad_status": plan.status,
        "squad_cost": plan.cost_tenths / 10,
        "squad_value_xi": plan.value_xi,
        "best_xi": xi.value,
        "with_reasons": len(first_row),
        "runs_pruned": pruned,
        "t60_rows_trimmed": trimmed,
    }
