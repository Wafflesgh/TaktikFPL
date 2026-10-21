"""xPts v1 — model per komponen (BLUEPRINT 5.1–5.2, versi ringkas tanpa Monte Carlo).

Untuk pemain i di laga f:
    λ_tim   = rata2_liga × serang(tim) × bertahan(lawan) × kandang
    λ_lawan = rata2_liga × serang(lawan) × bertahan(tim) × (1/kandang)
    E[gol]  = xG90_i × xMins/90 × (λ_tim / serang_rata2_tim)   (porsi gol pemain mengikuti kekuatan laga)
    E[assist] analog dengan xA90
    P(CS)   = exp(-λ_lawan) × P(main ≥60)
    xPts = Σ komponen × nilai poin dari fpl_scoring_rules (game_config.scoring) — tidak di-hardcode.

Semua rate pemain sudah di-shrink ke rata-rata posisi (empirical Bayes) oleh app.features.rates.
"""

import math
from dataclasses import dataclass

MODEL_VERSION = "xpts-v1"
HOME_ADV = 1.10  # rasio gol kandang/tandang tipikal PL; dikalibrasi lewat evaluasi berikutnya


@dataclass(frozen=True)
class PlayerRates:
    position: str
    xmins: float  # menit harapan (rata-rata 5 laga tim terakhir, 0 bila tidak main)
    p_play: float  # peluang tampil dari status FPL (1 = fit)
    xg90: float
    xa90: float
    bonus90: float
    saves90: float
    yc90: float
    p_defcon: float  # peluang mencapai ambang DefCon dalam laga ≥60 menit


@dataclass(frozen=True)
class MatchRates:
    team_att: float  # 1.0 = rata-rata liga
    team_def: float  # >1 = lebih sering kebobolan
    opp_att: float
    opp_def: float
    is_home: bool
    league_goals: float  # rata-rata gol per tim per laga


def _rule(rules: dict[str, float], key: str, pos: str | None = None, default: float = 0.0) -> float:
    if pos is not None and f"{key}_{pos}" in rules:
        return rules[f"{key}_{pos}"]
    return rules.get(key, default)


def p_sixty(xmins: float) -> float:
    """Peluang main ≥60 menit dari menit harapan (kurva sederhana, 0 di ≤20 menit, 1 di ≥80)."""
    return max(0.0, min(1.0, (xmins - 20.0) / 60.0))


def project_v1(p: PlayerRates, m: MatchRates, rules: dict[str, float]) -> dict[str, float]:
    pos = p.position
    xmins = p.xmins * p.p_play
    mins_frac = xmins / 90.0
    p60 = p_sixty(p.xmins) * p.p_play
    p_appear = p.p_play * (1.0 if p.xmins > 0 else 0.0) * min(1.0, p.xmins / 10.0)

    venue = HOME_ADV if m.is_home else 1.0 / HOME_ADV
    lam_team = m.league_goals * m.team_att * m.opp_def * venue
    lam_opp = m.league_goals * m.opp_att * m.team_def / venue
    attack_mult = lam_team / max(1e-6, m.league_goals * m.team_att)  # relatif terhadap laga rata-rata tim

    e_goals = p.xg90 * mins_frac * attack_mult
    e_assists = p.xa90 * mins_frac * attack_mult
    p_cs = math.exp(-lam_opp) * p60
    e_conceded_pen = (lam_opp / 2.0) * p60  # -1 per 2 gol kebobolan (aproksimasi linear)
    e_saves = p.saves90 * mins_frac * (m.opp_att / 1.0)
    e_bonus = p.bonus90 * mins_frac * math.sqrt(attack_mult)
    e_defcon = p.p_defcon * p60
    e_yc = p.yc90 * mins_frac

    comps = {
        "appearance": p_appear * _rule(rules, "short_play", default=1)
        + p60 * (_rule(rules, "long_play", default=2) - _rule(rules, "short_play", default=1)),
        "goals": e_goals * _rule(rules, "goals_scored", pos),
        "assists": e_assists * _rule(rules, "assists", default=3),
        "clean_sheet": p_cs * _rule(rules, "clean_sheets", pos),
        "conceded": e_conceded_pen * _rule(rules, "goals_conceded", pos),
        "saves": (e_saves / 3.0) * _rule(rules, "saves", default=1) if pos == "GKP" else 0.0,
        "bonus": e_bonus * _rule(rules, "bonus", default=1),
        "defcon": e_defcon * _rule(rules, "defensive_contribution", pos),
        "cards": e_yc * _rule(rules, "yellow_cards", default=-1),
    }
    xpts = sum(comps.values())
    return {
        "xpts": round(xpts, 3),
        "xmins": round(xmins, 2),
        "xg": round(e_goals, 4),
        "xa": round(e_assists, 4),
        "p_cs": round(p_cs, 4),
        "lam_team": round(lam_team, 3),
        "lam_opp": round(lam_opp, 3),
        # Kemudahan laga relatif terhadap laga rata-rata tim itu sendiri (dipakai untuk alasan).
        "att_mult": round(attack_mult, 3),
        "team_cs": round(math.exp(-lam_opp), 4),
        **{f"c_{k}": round(v, 3) for k, v in comps.items()},
    }
