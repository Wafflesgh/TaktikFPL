"""Konteks xPts v1 offline — replika app/features/rates.py (SQL) dengan pandas, dari CSV export.sh.

Rumus & shrinkage memakai fungsi app yang sama (ratings_from_rows, shrunk_rates, project_v1), jadi hanya
pengambilan data yang direplikasi. Tanpa data taktik Understat (v1_tactics tidak didukung offline).
"""

from typing import Any

import numpy as np
import pandas as pd

from app.features.rates import (
    LAST_TEAM_MATCHES,
    RateParams,
    calibrate_xmins,
    rate_totals,
    ratings_from_rows,
    shrunk_rates,
)
from app.lab.data import GwBundle
from app.lab.models import rate_params
from app.models import engine as v1


class EngineData:
    def __init__(self, st: pd.DataFrame, fx: pd.DataFrame, rules: dict[str, float]) -> None:
        self.rules = rules
        self.st = st
        done = fx[(fx.status == "finished") & fx.home_goals.notna()]
        xg = (
            st[st.team_id.notna()]
            .groupby(["fixture_id", "team_id"])
            .agg(xg=("expected_goals", "sum"), n=("expected_goals", "count"))
        )
        rows = []
        for r in done.itertuples():
            h = xg.loc[(r.id, r.home_team_id)] if (r.id, r.home_team_id) in xg.index else None
            a = xg.loc[(r.id, r.away_team_id)] if (r.id, r.away_team_id) in xg.index else None
            gh = float(h.xg) if h is not None and h.n > 0 else float(r.home_goals)
            ga = float(a.xg) if a is not None and a.n > 0 else float(r.away_goals)
            rows.append((r.kickoff_utc, int(r.home_team_id), gh, ga))
            rows.append((r.kickoff_utc, int(r.away_team_id), ga, gh))
        self.tm = pd.DataFrame(rows, columns=["kickoff", "team", "gf", "ga"]).sort_values("kickoff")

    def ratings(self, before: Any) -> tuple[dict[int, v1.TeamRating], float]:
        t = self.tm[self.tm.kickoff < before].groupby("team").tail(LAST_TEAM_MATCHES)
        g = t.groupby("team").agg(n=("gf", "size"), gf=("gf", "mean"), ga=("ga", "mean"))
        return ratings_from_rows([(int(k), int(r.n), float(r.gf), float(r.ga)) for k, r in g.iterrows()])

    def player_rates(self, before: Any, season_id: int, rp: RateParams) -> dict[int, dict[str, Any]]:
        st = self.st
        fin = st[(st.status == "finished") & (st.kickoff_utc < before)]
        m = fin[fin.minutes > 0].groupby("player_id").tail(rp.last_apps).copy()
        rn = m.groupby("player_id").cumcount(ascending=False)
        w = np.power(rp.decay, rn) * np.where(m.season_id == season_id, 1.0, rp.prev_weight)
        has_xg = m.expected_goals.notna()
        has_xa = m.expected_assists.notna()
        dc_ok = (m.minutes >= 60) & m.defensive_contribution.notna()
        cols = pd.DataFrame(
            {
                "player_id": m.player_id,
                "mins": w * m.minutes,
                "xg": w * m.expected_goals.fillna(0),
                "xg_mins": w * m.minutes.where(has_xg, 0),
                "xa": w * m.expected_assists.fillna(0),
                "g": w * m.goals_scored.where(has_xg, 0),
                "a": w * m.assists.where(has_xa, 0),
                "bonus": w * m.bonus,
                "saves": w * m.saves,
                "yc": w * m.yellow_cards,
                "dc_apps": w * dc_ok,
                "dc10": w * (dc_ok & (m.defensive_contribution >= 10)),
                "dc12": w * (dc_ok & (m.defensive_contribution >= 12)),
            }
        )
        agg = cols.groupby("player_id").sum()
        cur = fin[fin.season_id == season_id].groupby("player_id").tail(rp.xmins_matches).copy()
        cur["w"] = np.power(1.0 - rp.xmins_alpha, cur.groupby("player_id").cumcount(ascending=False))
        cur["wm"] = cur.w * cur.minutes
        g = cur.groupby("player_id")[["wm", "w"]].sum()
        out: dict[int, dict[str, Any]] = {
            int(p): {"xmins": calibrate_xmins(float(r.wm / r.w), rp)} for p, r in g.iterrows()
        }
        for pid, r in agg.iterrows():
            out.setdefault(int(pid), {"xmins": 0.0}).update(rate_totals(r, rp.finishing))
        return out

    def context(self, b: GwBundle, params: dict[str, Any]) -> v1.Context:
        positions = {pid: p.position for pid, p in b.players.items()}
        ratings, league = self.ratings(b.deadline)
        rp = rate_params(params)
        raw = self.player_rates(b.deadline, b.season_id, rp)
        return v1.Context(
            self.rules,
            ratings,
            league,
            shrunk_rates(raw, positions, self.rules, prior_min=rp.prior_min),
            fixture_power=float(params.get("fixture_power", 1.0)),
            minutes_curve=bool(params.get("minutes_curve", True)),
        )
