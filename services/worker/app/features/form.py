"""Form pemain: apakah sedang bagus, stabil, atau menurun (BLUEPRINT 2.3 & 4.2.2 & 4.8).

Prinsip:
- Jendela last4 / last8 / season dari riwayat per laga FPL (player_fpl_gw_stats).
- Metrik per 90 di-shrink ke rata-rata posisi berdasarkan menit (empirical Bayes sederhana),
  supaya 2 laga bagus dengan menit sedikit tidak dianggap tren.
- Label form menggabungkan OUTPUT (poin) dan UNDERLYING (xGI, DefCon), plus tren vs musim.
- Fungsi di modul ini murni (tanpa I/O) dan diuji di tests/test_form.py.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from statistics import mean
from typing import Any

# Prior shrinkage: setara 270 menit (±3 laga penuh) rata-rata posisi.
PRIOR_MINUTES = 270.0
# Minimal menit di last4 agar label form dinilai (di bawahnya: "minim_menit").
MIN_MINUTES_LAST4 = 135
WINDOWS = {"last4": 4, "last8": 8, "season": None}
# Metrik "underlying" per posisi untuk tren & persentil. MID/FWD: xGI per 90. GKP/DEF: poin per 90
# (ter-shrink) karena clean sheet & save adalah hasil tim, dan xGI bek terlalu jarang untuk stabil.
UNDERLYING_KEY = {"GKP": "points90_shrunk", "DEF": "points90_shrunk"}


@dataclass(frozen=True)
class MatchLine:
    """Satu laga pemain (urut kronologis di input)."""

    kickoff_ts: float
    minutes: int
    total_points: int
    goals: int
    assists: int
    bonus: int
    xg: float
    xa: float
    defcon: int
    clean_sheet: int


def _per90(total: float, minutes: float) -> float:
    return 90.0 * total / minutes if minutes > 0 else 0.0


def shrink(observed: float, minutes: float, prior_mean: float, prior_minutes: float = PRIOR_MINUTES) -> float:
    """Rata-rata berbobot menit antara nilai teramati dan rata-rata posisi."""
    if minutes <= 0:
        return prior_mean
    return (observed * minutes + prior_mean * prior_minutes) / (minutes + prior_minutes)


def window_metrics(matches: Sequence[MatchLine], n: int | None) -> dict[str, float]:
    """Metrik mentah untuk n laga terakhir (None = semua). Laga tanpa menit tetap dihitung
    di jumlah laga supaya rotasi/bench terlihat sebagai penurunan."""
    sel = list(matches[-n:]) if n else list(matches)
    minutes = float(sum(m.minutes for m in sel))
    played = [m for m in sel if m.minutes > 0]
    xg = sum(m.xg for m in sel)
    goals = sum(m.goals for m in sel)
    return {
        "matches": float(len(sel)),
        "appearances": float(len(played)),
        "starts_60": float(sum(1 for m in sel if m.minutes >= 60)),
        "minutes": minutes,
        "minutes_share": minutes / (90.0 * len(sel)) if sel else 0.0,
        "points": float(sum(m.total_points for m in sel)),
        "points_per_match": mean(m.total_points for m in sel) if sel else 0.0,
        "points90": _per90(sum(m.total_points for m in sel), minutes),
        "goals": float(goals),
        "assists": float(sum(m.assists for m in sel)),
        "bonus": float(sum(m.bonus for m in sel)),
        "xg": xg,
        "xa": sum(m.xa for m in sel),
        "xg90": _per90(xg, minutes),
        "xa90": _per90(sum(m.xa for m in sel), minutes),
        "xgi90": _per90(xg + sum(m.xa for m in sel), minutes),
        "defcon90": _per90(sum(m.defcon for m in sel), minutes),
        "clean_sheets": float(sum(m.clean_sheet for m in sel)),
        "goals_minus_xg": goals - xg,
    }


def position_priors(players_season: Sequence[dict[str, float]]) -> dict[str, float]:
    """Rata-rata posisi (berbobot menit) untuk metrik per 90 yang di-shrink."""
    total_min = sum(p["minutes"] for p in players_season)
    if total_min <= 0:
        return {"points90": 0.0, "xgi90": 0.0, "xg90": 0.0, "xa90": 0.0, "defcon90": 0.0}
    return {
        key: sum(p[key] * p["minutes"] for p in players_season) / total_min
        for key in ("points90", "xgi90", "xg90", "xa90", "defcon90")
    }


def with_shrinkage(raw: dict[str, float], prior: dict[str, float]) -> dict[str, float]:
    out = dict(raw)
    for key in ("points90", "xgi90", "xg90", "xa90", "defcon90"):
        out[f"{key}_shrunk"] = shrink(raw[key], raw["minutes"], prior[key])
    return out


def percentile(value: float, population: Sequence[float]) -> float:
    if not population:
        return 0.5
    below = sum(1 for v in population if v < value)
    equal = sum(1 for v in population if v == value)
    return (below + 0.5 * equal) / len(population)


def form_label(
    last4: dict[str, float],
    season: dict[str, float],
    pct_points: float,
    pct_underlying: float,
    position: str,
) -> dict[str, Any]:
    """Label form + alasan singkat (Bahasa Indonesia). Ambang sengaja sederhana & transparan."""
    if last4["minutes"] < MIN_MINUTES_LAST4:
        return {"label": "minim_menit", "reasons": ["very few minutes in the last 4 matches"]}

    # Tren: last4 mentah di-shrink ke baseline musim PEMAIN ITU SENDIRI (bukan rata-rata posisi),
    # agar beda ukuran sampel last4 vs season tidak menciptakan tren palsu.
    trend_key = UNDERLYING_KEY.get(position, "xgi90_shrunk")
    base = season[trend_key]
    recent = shrink(last4[trend_key.removesuffix("_shrunk")], last4["minutes"], base)
    trend = (recent - base) / base if base > 0 else 0.0
    score = 0.6 * pct_points + 0.4 * pct_underlying

    metric = "points per 90" if position in UNDERLYING_KEY else "xGI per 90"
    reasons: list[str] = []
    if score >= 0.85:
        reasons.append(f"last 4 matches in the top 15% of {position}s")
    elif score < 0.35:
        reasons.append(f"last 4 matches below most other {position}s")
    if trend >= 0.15:
        reasons.append(f"{metric} over the last 4 is up vs their season average")
    elif trend <= -0.15:
        reasons.append(f"{metric} over the last 4 is down vs their season average")
    if last4["minutes_share"] < 0.6:
        reasons.append("minutes are dropping (rotation risk)")

    if score >= 0.85 and trend > -0.15:
        label = "panas"
    elif score >= 0.65:
        label = "bagus"
    elif score >= 0.35:
        label = "menurun" if trend <= -0.15 else "stabil"
    elif trend > 0.15:
        label = "stabil"
        reasons.append("returns not there yet but the trend is improving")
    else:
        label = "dingin"

    # Regression-to-the-mean (BLUEPRINT 4.8 #1)
    g_minus_xg = last4["goals_minus_xg"]
    if g_minus_xg >= 1.5:
        reasons.append("goals well above xG — likely to regress (overperforming)")
    elif g_minus_xg <= -1.5:
        reasons.append("goals well below xG — bounce-back candidate (underperforming)")
    return {"label": label, "score": round(score, 3), "trend": round(trend, 3), "reasons": reasons}


def build_player_form(
    matches_by_player: Mapping[int, Sequence[MatchLine]],
    position_by_player: Mapping[int, str],
) -> dict[int, dict[str, dict[str, Any]]]:
    """Hitung form semua pemain sekaligus (prior & persentil per posisi).

    Return: {player_id: {window_label: metrics}} — metrics last4 berisi juga form label.
    """
    raw: dict[int, dict[str, dict[str, float]]] = {
        pid: {w: window_metrics(ms, n) for w, n in WINDOWS.items()}
        for pid, ms in matches_by_player.items()
        if ms
    }
    positions = sorted({position_by_player[pid] for pid in raw})
    priors = {
        pos: position_priors([raw[p]["season"] for p in raw if position_by_player[p] == pos])
        for pos in positions
    }
    shrunk = {
        pid: {w: with_shrinkage(m, priors[position_by_player[pid]]) for w, m in wins.items()}
        for pid, wins in raw.items()
    }

    # Persentil di antara pemain posisi sama yang cukup bermain di last4.
    pool: dict[str, dict[str, list[float]]] = {pos: {"points": [], "under": []} for pos in positions}
    for pid, wins in shrunk.items():
        if wins["last4"]["minutes"] >= MIN_MINUTES_LAST4:
            pos = position_by_player[pid]
            pool[pos]["points"].append(wins["last4"]["points_per_match"])
            pool[pos]["under"].append(wins["last4"][UNDERLYING_KEY.get(pos, "xgi90_shrunk")])

    out: dict[int, dict[str, dict[str, Any]]] = {}
    for pid, wins in shrunk.items():
        pos = position_by_player[pid]
        last4 = wins["last4"]
        pct_points = percentile(last4["points_per_match"], pool[pos]["points"])
        pct_under = percentile(last4[UNDERLYING_KEY.get(pos, "xgi90_shrunk")], pool[pos]["under"])
        verdict = form_label(last4, wins["season"], pct_points, pct_under, pos)
        result: dict[str, dict[str, Any]] = {
            w: {k: round(v, 4) for k, v in m.items()} for w, m in wins.items()
        }
        result["last4"].update(
            {
                "form_label": verdict["label"],
                "form_score": verdict.get("score"),
                "form_trend": verdict.get("trend"),
                "form_reasons": verdict["reasons"],
                "pct_points_pos": round(pct_points, 3),
                "pct_underlying_pos": round(pct_under, 3),
                "position": pos,
            }
        )
        out[pid] = result
    return out
