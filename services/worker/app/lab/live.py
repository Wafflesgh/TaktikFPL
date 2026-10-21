"""Model aktif untuk proyeksi produksi — dipilih dari Model Lab.

app_config 'active_model' = {"name": "<model>" | "auto"}. "auto" memilih model dengan poin simulasi musim
tertinggi pada musim terakhir yang punya ≥ AUTO_MIN_GWS GW teruji di lab. Default (belum ada pilihan /
belum ada hasil lab) = v1_tactics, model produksi bawaan.
"""

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.lab.data import load_bundle, season_gameweeks
from app.lab.models import SPEC_BY_NAME, Preds, StackLearner, predict_all
from app.models.engine import scoring_rules

DEFAULT_MODEL = "v1_tactics"
AUTO_MIN_GWS = 10


def configured_model(conn: Connection) -> str:
    v = conn.execute(text("select value from public.app_config where key = 'active_model'")).scalar()
    name = (v or {}).get("name") if isinstance(v, dict) else None
    return str(name) if name else DEFAULT_MODEL


def lab_champion(conn: Connection) -> tuple[str | None, dict[str, Any]]:
    """Model dengan sim_total akhir tertinggi pada musim lab terbaru yang cukup panjang."""
    rows = conn.execute(
        text(
            """
            with t as (
              select e.model_version, e.detail ->> 'season' season, e.value, g.number,
                     row_number() over (partition by e.model_version, e.detail ->> 'season'
                                        order by g.number desc) rn,
                     count(*) over (partition by e.model_version, e.detail ->> 'season') n
              from public.model_evaluations e join public.gameweeks g on g.id = e.gameweek_id
              where e.model_version like 'lab:%' and e.metric = 'sim_total'
            )
            select model_version, season, value, n from t where rn = 1
            """
        )
    ).all()
    by_season: dict[str, list[tuple[float, str, int]]] = {}
    for r in rows:
        by_season.setdefault(r.season, []).append((float(r.value), r.model_version[4:], int(r.n)))
    eligible = sorted(
        (s for s, v in by_season.items() if max(n for _, _, n in v) >= AUTO_MIN_GWS), reverse=True
    )
    if not eligible:
        return None, {}
    season = eligible[0]
    best = max(by_season[season])
    return best[1], {"season": season, "sim_total": best[0], "gws": best[2]}


def resolve_active(conn: Connection) -> tuple[str, dict[str, Any]]:
    name = configured_model(conn)
    if name == "auto":
        champ, info = lab_champion(conn)
        return (champ or DEFAULT_MODEL), {"mode": "auto", **info}
    if name not in SPEC_BY_NAME:
        return DEFAULT_MODEL, {"mode": "fallback", "requested": name}
    return name, {"mode": "manual"}


def live_predictions(
    conn: Connection, season_id: int, first_gw: int, horizon: int, name: str
) -> Preds | None:
    """Prediksi model `name` untuk GW first_gw .. first_gw+horizon-1 (data sampai sekarang)."""
    gameweeks = season_gameweeks(conn, season_id)
    b = load_bundle(conn, season_id, first_gw, horizon, gameweeks, with_actual=False)
    rules = scoring_rules(conn, season_id)
    learner = None
    if name == "ensemble_stack":
        v = conn.execute(
            text("select value from public.app_config where key = 'lab_ensemble_weights'")
        ).scalar()
        weights = (v or {}).get("weights") if isinstance(v, dict) else None
        if weights:
            learner = _FixedWeights(list(weights), weights)
    preds, _ = predict_all(conn, b, rules, learner)
    return preds.get(name)


class _FixedWeights(StackLearner):
    """Bobot ensemble hasil lab terakhir (tidak belajar ulang saat live)."""

    def __init__(self, members: list[str], weights: dict[str, float]):
        super().__init__(members)
        self._w = weights

    def weights(self) -> dict[str, float] | None:
        return self._w
