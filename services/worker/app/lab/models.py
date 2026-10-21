"""Model Lab: beberapa model xPts dengan pertimbangan berbeda, diuji dengan data yang sama.

Setiap model memberi xPts per pemain per GW untuk horizon (g .. g+H-1). Model dasar menghitung dari
GwBundle; ensemble menggabungkan model dasar (rata-rata, atau bobot hasil belajar dari GW sebelumnya).
Semua angka deterministik dari data — tidak ada LLM.
"""

from collections.abc import Callable
from dataclasses import dataclass, field, replace
from statistics import mean
from typing import Any

import numpy as np
from scipy.optimize import nnls
from sqlalchemy.engine import Connection

from app.features.tactics import player_tactics, team_styles
from app.lab.data import GwBundle
from app.models import engine as v1

Preds = dict[int, dict[int, float]]  # pemain → GW → xPts


@dataclass(frozen=True)
class ModelSpec:
    name: str
    label: str
    idea: str  # pertimbangan utama (ditampilkan di web)
    kind: str  # baseline | engine | ensemble
    params: dict[str, Any] = field(default_factory=dict)


SPECS: list[ModelSpec] = [
    ModelSpec(
        "recent4",
        "Recent points",
        "Average FPL points over the team's last 4 matches. Pure momentum.",
        "baseline",
    ),
    ModelSpec(
        "season_ppg",
        "Season PPG",
        "Points per match this season (last 10 matches when the season is young).",
        "baseline",
    ),
    ModelSpec(
        "fpl_xp",
        "FPL official xP",
        "FPL's published expected points. Benchmark only: 83% of historical values are 0 and they may be "
        "computed after the gameweek, so it is kept out of both ensembles.",
        "baseline",
        {"benchmark": True},  # tidak boleh jadi model aktif (data tidak ada untuk prediksi live)
    ),
    ModelSpec(
        "form_fdr",
        "Form × fixture",
        "Recent points per 90 × expected minutes × FPL fixture difficulty (FDR).",
        "baseline",
    ),
    ModelSpec(
        "v1",
        "xPts v1",
        "Component model: minutes, goals, assists, clean sheets, bonus, defcon from xG/xA and team strength.",
        "engine",
        {"tactics": False},
    ),
    ModelSpec(
        "v1_tactics",
        "v1 + tactics",
        "v1 plus each player's record against low-block / high-press opponents (production model).",
        "engine",
        {"tactics": True},
    ),
    ModelSpec(
        "hot_form",
        "Hot form",
        "v1 using only the last 8 appearances with light shrinkage: trusts current form.",
        "engine",
        {"tactics": False, "last_apps": 8, "prior_min": 200.0},
    ),
    ModelSpec(
        "fixture_chaser",
        "Fixture chaser",
        "v1 with opponent strength amplified (power 1.6): chases easy fixtures.",
        "engine",
        {"tactics": False, "fixture_power": 1.6},
    ),
    ModelSpec(
        "minutes_first",
        "Minutes first",
        "v1 with expected minutes from the last 3 matches only: punishes rotation quickly.",
        "engine",
        {"tactics": False, "xmins_matches": 3},
    ),
    ModelSpec(
        "crowd",
        "Crowd",
        "v1 adjusted by ownership within position (−10% to +15%): managers' collective information.",
        "engine",
        {"tactics": False, "crowd": True},
    ),
    ModelSpec(
        "ensemble_mean",
        "Ensemble (mean)",
        "Plain average of v1 + tactics, Hot form, Fixture chaser and Season PPG.",
        "ensemble",
        {"members": ["v1_tactics", "hot_form", "fixture_chaser", "season_ppg"]},
    ),
    ModelSpec(
        "ensemble_stack",
        "Ensemble (learned)",
        "Weights learned from earlier gameweeks only (non-negative least squares on actual points).",
        "ensemble",
        {
            "members": [
                "recent4",
                "season_ppg",
                "form_fdr",
                "v1",
                "v1_tactics",
                "hot_form",
                "fixture_chaser",
                "minutes_first",
                "crowd",
            ]
        },
    ),
]
SPEC_BY_NAME = {s.name: s for s in SPECS}
BASE_MODELS = [s.name for s in SPECS if s.kind != "ensemble"]
FDR_MULT = {1: 1.25, 2: 1.12, 3: 1.0, 4: 0.88, 5: 0.75}


def _per_fixture(b: GwBundle, per_match: dict[int, float]) -> Preds:
    """Nilai per laga → per GW (dikali jumlah laga tim di GW itu; blank = 0)."""
    out: Preds = {}
    for pid, info in b.players.items():
        v = per_match.get(pid, 0.0)
        out[pid] = {g: v * b.n_fixtures(info.team, g) for g in b.gws}
    return out


def recent4(b: GwBundle) -> Preds:
    return _per_fixture(b, {pid: mean(p for p, _, _ in h[:4]) for pid, h in b.history.items() if h})


def season_ppg(b: GwBundle) -> Preds:
    vals = {}
    for pid, h in b.history.items():
        this = [p for p, _, cur in h if cur]
        rows = this if len(this) >= 4 else [p for p, _, _ in h[:10]]
        if rows:
            vals[pid] = mean(rows)
    return _per_fixture(b, vals)


def fpl_xp(b: GwBundle) -> Preds | None:
    if not b.fpl_xp:
        return None  # musim tanpa data xP resmi → model dilewati
    out: Preds = {}
    for pid, info in b.players.items():
        n0 = max(1, b.n_fixtures(info.team, b.gw))
        per = b.fpl_xp.get(pid, 0.0) / n0
        out[pid] = {g: per * b.n_fixtures(info.team, g) for g in b.gws}
    return out


def form_fdr(b: GwBundle) -> Preds:
    out: Preds = {}
    for pid, info in b.players.items():
        h = b.history.get(pid, [])
        played = [(p, m) for p, m, _ in h[:8] if m > 0][:6]
        mins = sum(m for _, m in played)
        p90 = (sum(p for p, _ in played) + 3.5 * 2) / ((mins + 180) / 90.0)  # prior 2 laga @3.5/90
        xmins = mean(m for _, m, _ in h[:4]) if h else 0.0
        base = p90 * xmins / 90.0
        out[pid] = {
            g: sum(base * FDR_MULT.get(f.fdr, 1.0) for f in b.fixtures.get(info.team, []) if f.gw == g)
            for g in b.gws
        }
    return out


@dataclass
class EngineCache:
    """Konteks v1 per GW, dibagi antar varian supaya query DB tidak diulang."""

    base: v1.Context | None = None
    tactics: v1.Context | None = None
    variants: dict[tuple[int, int, float], v1.Context] = field(default_factory=dict)


def engine_context(
    conn: Connection, b: GwBundle, spec: ModelSpec, rules: dict[str, float], cache: EngineCache
) -> v1.Context:
    positions = {pid: p.position for pid, p in b.players.items()}
    p = spec.params
    key = (
        int(p.get("last_apps", v1.LAST_APPS)),
        int(p.get("xmins_matches", 5)),
        float(p.get("prior_min", v1.PLAYER_PRIOR_MIN)),
    )
    if key not in cache.variants:
        cache.variants[key] = v1.build_context(
            conn,
            b.deadline,
            b.season_id,
            positions,
            rules=rules,
            last_apps=key[0],
            xmins_matches=key[1],
            prior_min=key[2],
            tactics=False,
        )
    ctx = cache.variants[key]
    if p.get("tactics"):
        if cache.tactics is None:
            cache.tactics = replace(
                ctx, styles=team_styles(conn, b.deadline), tactics=player_tactics(conn, b.deadline)
            )
        ctx = cache.tactics
    if p.get("fixture_power"):
        ctx = replace(ctx, fixture_power=float(p["fixture_power"]))
    return ctx


def engine_model(b: GwBundle, spec: ModelSpec, ctx: v1.Context) -> Preds:
    out: Preds = {}
    crowd = _crowd_mult(b) if spec.params.get("crowd") else {}
    for pid, info in b.players.items():
        per = {g: 0.0 for g in b.gws}
        for f in b.fixtures.get(info.team, []):
            per[f.gw] += v1.project(ctx, pid, info.position, info.team, f.opp, f.home)["xpts"]
        m = crowd.get(pid, 1.0)
        out[pid] = {g: x * m for g, x in per.items()}
    return out


def _crowd_mult(b: GwBundle) -> dict[int, float]:
    """Persentil kepemilikan dalam posisi → pengali 0.90 .. 1.15."""
    by_pos: dict[str, list[tuple[int, int]]] = {}
    for pid, info in b.players.items():
        by_pos.setdefault(info.position, []).append((info.selected, pid))
    out: dict[int, float] = {}
    for rows in by_pos.values():
        rows.sort()
        n = len(rows)
        for i, (_, pid) in enumerate(rows):
            pct = (i + 0.5) / n
            out[pid] = 0.90 + 0.25 * pct
    return out


BASELINES: dict[str, Callable[[GwBundle], Preds | None]] = {
    "recent4": recent4,
    "season_ppg": season_ppg,
    "fpl_xp": fpl_xp,
    "form_fdr": form_fdr,
}


def ensemble_mean(preds: dict[str, Preds], members: list[str]) -> Preds | None:
    avail = [preds[m] for m in members if m in preds]
    if not avail:
        return None
    out: Preds = {}
    for pid in avail[0]:
        out[pid] = {g: mean(p.get(pid, {}).get(g, 0.0) for p in avail) for g in avail[0][pid]}
    return out


def ensemble_weighted(preds: dict[str, Preds], weights: dict[str, float]) -> Preds | None:
    """Σ bobot × prediksi model (bobot NNLS mentah, sehingga level poin ikut terkalibrasi)."""
    avail = {m: w for m, w in weights.items() if m in preds and w > 0}
    if not avail:
        return None
    # Model berbobot yang datanya tidak ada di suatu musim: bobotnya dibagi ke model yang ada.
    k = sum(w for w in weights.values() if w > 0) / sum(avail.values())
    first = preds[next(iter(avail))]
    return {
        pid: {g: k * sum(preds[m].get(pid, {}).get(g, 0.0) * w for m, w in avail.items()) for g in first[pid]}
        for pid in first
    }


@dataclass
class StackLearner:
    """Mengumpulkan (prediksi model dasar GW g, poin aktual) dan memperbarui bobot NNLS — hanya memakai
    GW yang sudah selesai sebelum GW yang diprediksi (tanpa kebocoran data masa depan)."""

    members: list[str]
    rows: list[list[float]] = field(default_factory=list)
    target: list[float] = field(default_factory=list)
    min_gws: int = 3
    gws_seen: int = 0

    def weights(self) -> dict[str, float] | None:
        if self.gws_seen < self.min_gws or not self.rows:
            return None
        x = np.array(self.rows, dtype=float)
        y = np.array(self.target, dtype=float)
        w, _ = nnls(x, y)
        if w.sum() <= 0:
            return None
        return {m: float(v) for m, v in zip(self.members, w, strict=True)}

    def add(self, preds: dict[str, Preds], b: GwBundle) -> None:
        # Model yang tidak tersedia (mis. model yang datanya tidak ada di suatu musim) diisi 0.
        for pid, (pts, mins) in b.actual.items():
            if pid not in b.players:
                continue
            row = [preds[m].get(pid, {}).get(b.gw, 0.0) if m in preds else 0.0 for m in self.members]
            if max(row) <= 0.05 and mins == 0:
                continue
            self.rows.append(row)
            self.target.append(float(pts))
        self.gws_seen += 1


def predict_all(
    conn: Connection, b: GwBundle, rules: dict[str, float], learner: StackLearner | None
) -> tuple[dict[str, Preds], dict[str, float] | None]:
    cache = EngineCache()
    preds: dict[str, Preds] = {}
    for spec in SPECS:
        if spec.kind == "baseline":
            p = BASELINES[spec.name](b)
            if p is not None:
                preds[spec.name] = p
        elif spec.kind == "engine":
            preds[spec.name] = engine_model(b, spec, engine_context(conn, b, spec, rules, cache))
    m = ensemble_mean(preds, SPEC_BY_NAME["ensemble_mean"].params["members"])
    if m is not None:
        preds["ensemble_mean"] = m
    weights = learner.weights() if learner else None
    stack = ensemble_weighted(preds, weights) if weights else m
    if stack is not None:
        preds["ensemble_stack"] = stack
    return preds, weights
