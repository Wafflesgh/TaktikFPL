"""model_lab: uji semua model Model Lab secara point-in-time pada GW yang sudah selesai.

    model_lab()                                   # musim lalu + musim berjalan (default)
    model_lab:seasons=2025/26,2026/27,min_gw=4

Per model per GW → public.model_evaluations (model_version 'lab:<nama>'):
mae_xpts, rmse_xpts, spearman, top10_actual_avg, fh_points (weekly Free Hit), sim_points (season sim,
GW itu), sim_total (kumulatif musim), sim_hits. Bobot ensemble terakhir → app_config 'lab_ensemble_weights'.
Aturan poin musim lalu yang tidak tersimpan memakai aturan musim berjalan (2025/26 = aturan defcon yang sama).
"""

import json
import time
from typing import Any

import structlog
from sqlalchemy import text

from app.db import get_engine
from app.jobs.evaluate_model import metrics
from app.lab.data import load_bundle, season_gameweeks
from app.lab.models import SPECS, StackLearner, predict_all
from app.lab.simulate import SeasonSim, free_hit_points
from app.models.engine import scoring_rules
from app.scheduler.runner import JobSkipped, job

log = structlog.get_logger()

DEFAULT_SEASONS = "2025/26,2026/27"
HORIZON = 6
PREFIX = "lab:"


def _season_rules(conn: Any, season_id: int) -> dict[str, float]:
    rules = scoring_rules(conn, season_id)
    if rules:
        return rules
    cur = conn.execute(text("select id from public.seasons where is_current")).scalar()
    return scoring_rules(conn, int(cur)) if cur else {}


def _latest_lab_gw(conn: Any) -> int | None:
    return conn.execute(
        text("select max(gameweek_id) from public.model_evaluations where model_version like 'lab:%'")
    ).scalar()


def _latest_finished_gw(conn: Any) -> int | None:
    return conn.execute(
        text(
            """
            select g.id from public.gameweeks g join public.seasons s on s.id = g.season_id and s.is_current
            where g.is_finished order by g.number desc limit 1
            """
        )
    ).scalar()


@job("model_lab")
def model_lab(
    seasons: str = DEFAULT_SEASONS, min_gw: int = 4, only_new: bool | str = False
) -> dict[str, Any]:
    """only_new: dipakai tick — lewati bila GW selesai terbaru sudah ada di hasil lab."""
    engine = get_engine()
    if str(only_new).lower() in ("1", "true", "yes"):
        with engine.connect() as conn:
            latest = _latest_finished_gw(conn)
            if latest is not None and _latest_lab_gw(conn) == latest:
                raise JobSkipped("hasil lab sudah mencakup GW selesai terbaru")
    labels = [s.strip() for s in seasons.split(",") if s.strip()]
    stack_members: list[str] = next(s.params["members"] for s in SPECS if s.name == "ensemble_stack")
    learner = StackLearner(stack_members)
    # Label & pertimbangan tiap model ikut disimpan (web membaca model_evaluations, bukan app_config).
    meta = {
        s.name: {"label": s.label, "idea": s.idea, "kind": s.kind} for s in SPECS
    }  # bobot dipelajari lintas musim, berurutan waktu
    summary: dict[str, dict[str, float]] = {}
    started = time.monotonic()
    weights: dict[str, float] | None = None
    with engine.connect() as conn:
        seasons_rows = conn.execute(
            text("select id, label from public.seasons where label = any(:l) order by label"), {"l": labels}
        ).all()
    if not seasons_rows:
        raise JobSkipped("musim tidak ditemukan")
    for season in seasons_rows:
        sims: dict[str, SeasonSim] = {s.name: SeasonSim() for s in SPECS}
        with engine.connect() as conn:
            gameweeks = season_gameweeks(conn, int(season.id))
            rules = _season_rules(conn, int(season.id))
        done = [n for _, n, _, fin in gameweeks if fin and n >= int(min_gw)]
        for gw in done:
            with engine.connect() as conn:
                b = load_bundle(conn, int(season.id), gw, HORIZON, gameweeks)
                preds, weights = predict_all(conn, b, rules, learner)
            rows: list[dict[str, Any]] = []
            for name, p in preds.items():
                pred, act = [], []
                for pid in b.players:
                    x = p.get(pid, {}).get(gw, 0.0)
                    pts, mins = b.actual.get(pid, (0, 0))
                    if x <= 0.05 and mins == 0:
                        continue
                    pred.append(x)
                    act.append(float(pts))
                if len(pred) < 20:
                    continue
                m = metrics(pred, act)
                fh, _ = free_hit_points({pid: v.get(gw, 0.0) for pid, v in p.items()}, b)
                sim = sims[name]
                sim_pts = sim.step(p, b)
                values = {
                    "mae_xpts": m["mae_xpts"],
                    "rmse_xpts": m["rmse_xpts"],
                    "spearman": m["spearman"],
                    "top10_actual_avg": m["top10_actual_avg"],
                    "n_players": m["n_players"],
                    "fh_points": float(fh),
                    "sim_points": float(sim_pts),
                    "sim_total": float(sim.total),
                    "sim_hits": float(sim.hits),
                }
                detail = {"season": season.label, "gw": gw, "sim": sim.log[-1]}
                for metric, value in values.items():
                    rows.append(
                        {
                            "g": b.gw_id,
                            "v": PREFIX + name,
                            "m": metric,
                            "val": value,
                            "d": json.dumps(
                                detail
                                if metric == "sim_points"
                                else {**meta[name], "season": season.label, "gw": gw}
                                if metric == "sim_total"
                                else {"season": season.label, "gw": gw}
                            ),
                        }
                    )
            learner.add(preds, b)
            with engine.begin() as conn:
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
                    rows,
                )
            log.info(
                "lab.gw",
                season=season.label,
                gw=gw,
                models=len(preds),
                secs=round(time.monotonic() - started),
            )
        summary[season.label] = {name: float(s.total) for name, s in sims.items() if s.log}
    final_weights = learner.weights()
    last_gw_id = None
    with engine.connect() as conn:
        last_gw_id = _latest_lab_gw(conn)
    with engine.begin() as conn:
        if final_weights and last_gw_id is not None:
            conn.execute(text("delete from public.model_evaluations where model_version = 'lab:weights'"))
            conn.execute(
                text(
                    """
                    insert into public.model_evaluations (gameweek_id, model_version, metric, value, detail)
                    values (:g, 'lab:weights', :m, :v, cast(:d as jsonb))
                    """
                ),
                [
                    {"g": last_gw_id, "m": m, "v": w, "d": json.dumps({"gws_learned": learner.gws_seen})}
                    for m, w in final_weights.items()
                ],
            )
        conn.execute(
            text(
                """
                insert into public.app_config (key, value) values ('lab_ensemble_weights', cast(:v as jsonb))
                on conflict (key) do update set value = excluded.value
                """
            ),
            {"v": json.dumps({"weights": final_weights, "gws_learned": learner.gws_seen})},
        )
    return {
        "season_sim_totals": summary,
        "ensemble_weights": final_weights,
        "secs": round(time.monotonic() - started),
    }


@job("set_active_model")
def set_active_model(name: str) -> dict[str, Any]:
    """Pilih model untuk proyeksi produksi: nama model lab, 'auto' (juara lab), atau 'v1_tactics' (bawaan)."""
    if name != "auto" and name not in {s.name for s in SPECS if not s.params.get("benchmark")}:
        raise ValueError(f"model tidak dikenal atau hanya pembanding: {name}")
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                insert into public.app_config (key, value) values ('active_model', cast(:v as jsonb))
                on conflict (key) do update set value = excluded.value
                """
            ),
            {"v": json.dumps({"name": name})},
        )
    return {"active_model": name}
