"""xPts v0 — proyeksi poin FPL sederhana & transparan (pengganti sementara model BLUEPRINT 5).

xPts(pemain, laga) = poin_per90 × (xMins / 90) × faktor_lawan × faktor_kandang

- poin_per90: campuran form ter-shrink (player_form_features, BLUEPRINT 4.2.2):
  60% jendela 4 laga terakhir + 40% musim — form terkini lebih berat, sampel kecil sudah di-shrink.
- xMins: 90 × porsi menit (60% last4 + 40% last8) × peluang main dari status FPL
  (a = tersedia; d = chance_of_playing; i/s/u/n = 0).
- faktor_lawan dari FDR FPL (1 mudah … 5 sulit); faktor_kandang untuk laga kandang.

Fungsi murni tanpa I/O. Parameter dikumpulkan di PARAMS agar mudah dikalibrasi lewat evaluasi
(model_evaluations) di versi berikutnya. Model lengkap (Poisson/Monte Carlo) = Fase 2 lanjutan.
"""

from dataclasses import dataclass
from typing import Any

MODEL_VERSION = "xpts-v0"

PARAMS: dict[str, Any] = {
    "w_last4": 0.6,
    "w_last4_minutes": 0.6,
    "fdr_factor": {1: 1.20, 2: 1.10, 3: 1.00, 4: 0.88, 5: 0.78},
    "home_factor": 1.05,
    "away_factor": 0.97,
}

UNAVAILABLE = {"i", "s", "u", "n"}


@dataclass(frozen=True)
class PlayerForm:
    points90_last4: float | None
    points90_season: float | None
    minutes_share_last4: float | None
    minutes_share_last8: float | None
    status: str | None
    chance_next: int | None


@dataclass(frozen=True)
class FixtureCtx:
    fdr: int | None
    is_home: bool


def play_probability(status: str | None, chance_next: int | None) -> float:
    if status in UNAVAILABLE:
        return 0.0
    if chance_next is not None:
        return max(0.0, min(1.0, chance_next / 100))
    return 1.0


def expected_minutes(f: PlayerForm) -> float:
    w = PARAMS["w_last4_minutes"]
    m4, m8 = f.minutes_share_last4, f.minutes_share_last8
    if m4 is None and m8 is None:
        share = 0.0
    elif m4 is None:
        share = m8 or 0.0
    elif m8 is None:
        share = m4
    else:
        share = w * m4 + (1 - w) * m8
    return 90.0 * max(0.0, min(1.0, share)) * play_probability(f.status, f.chance_next)


def points_per90(f: PlayerForm) -> float:
    w = PARAMS["w_last4"]
    p4, ps = f.points90_last4, f.points90_season
    if p4 is None and ps is None:
        return 0.0
    if p4 is None:
        return ps or 0.0
    if ps is None:
        return p4
    return w * p4 + (1 - w) * ps


def project(f: PlayerForm, fx: FixtureCtx) -> dict[str, float]:
    """Proyeksi satu pemain di satu laga. Mengembalikan xpts + komponennya (untuk breakdown)."""
    xmins = expected_minutes(f)
    p90 = points_per90(f)
    fdr_factor = PARAMS["fdr_factor"].get(fx.fdr or 3, 1.0)
    venue = PARAMS["home_factor"] if fx.is_home else PARAMS["away_factor"]
    xpts = p90 * (xmins / 90.0) * fdr_factor * venue
    return {
        "xpts": round(xpts, 3),
        "xmins": round(xmins, 2),
        "points90": round(p90, 3),
        "fdr_factor": fdr_factor,
        "venue_factor": venue,
        "p_play": round(play_probability(f.status, f.chance_next), 3),
    }
