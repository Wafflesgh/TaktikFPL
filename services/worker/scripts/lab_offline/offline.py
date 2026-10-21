"""Backtest Model Lab offline dari CSV hasil export.sh — tanpa koneksi DB, cepat untuk tuning model.

GwBundle dibangun ulang dengan logika yang sama seperti app/lab/data.py (Season PPG, Recent, Form × fixture
2025/26 identik dengan job model_lab produksi). Model engine (v1 & varian) memakai replika konteks di
engine.py; v1_tactics tidak didukung (butuh data Understat).

    cd services/worker
    uv run python -m scripts.lab_offline.offline 2025/26 season_ppg,points_plus
    uv run python -m scripts.lab_offline.offline 2019/20,2020/21 points_plus --cand path/ke/kandidat.py

--cand: file Python dengan dict MODELS = {nama: fungsi(bundle) -> Preds} untuk mencoba model baru.
Bundle punya atribut tambahan `ext` (pemain → DataFrame riwayat, terbaru dulu: gol, assist, xG, xA, …).
"""

import argparse
import importlib.util
import pickle
import time
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import pandas as pd

from app.jobs.evaluate_model import metrics
from app.lab.data import HISTORY_ROWS, Fx, GwBundle, PInfo
from app.lab.models import BASELINES, SPECS, engine_model
from app.lab.simulate import SeasonSim, free_hit_points

from .engine import EngineData

D = Path(__file__).parent / ".data"
BAD = {"postponed", "cancelled", "abandoned"}
HORIZON = 6
MIN_GW = 4


class Store:
    def __init__(self) -> None:
        self.seasons = pd.read_csv(D / "seasons.csv")
        self.gws = pd.read_csv(D / "gameweeks.csv", parse_dates=["deadline_utc"])
        self.fx = pd.read_csv(D / "fixtures.csv", parse_dates=["kickoff_utc"], na_values=["NULL"])
        self.ps = pd.read_csv(D / "player_seasons.csv", na_values=["NULL"])
        sr = pd.read_csv(D / "scoring_rules.csv")
        cur = int(self.seasons.loc[self.seasons.is_current.astype(str).str.lower() == "true", "id"].iloc[0])
        # Seperti model_lab: musim tanpa aturan tersimpan memakai aturan musim berjalan.
        self.rules = {str(r.rule_key): float(r.value) for r in sr[sr.season_id == cur].itertuples()}
        st = pd.concat([pd.read_csv(p, na_values=["NULL"]) for p in D.glob("stats_*.csv")], ignore_index=True)
        cols = ["id", "season_id", "kickoff_utc", "status"]
        st = st.merge(self.fx[cols].rename(columns={"id": "fixture_id"}), on="fixture_id")
        self.st = st.sort_values(["player_id", "kickoff_utc"]).reset_index(drop=True)

    def season_id(self, label: str) -> int:
        return int(self.seasons.loc[self.seasons.label == label, "id"].iloc[0])

    def gameweeks(self, sid: int) -> list[tuple[int, int, Any, bool]]:
        g = self.gws[self.gws.season_id == sid].sort_values("number")
        return [(int(r.id), int(r.number), r.deadline_utc, bool(r.is_finished)) for r in g.itertuples()]

    def bundle(self, sid: int, gw: int, gameweeks: list[tuple[int, int, Any, bool]]) -> GwBundle:
        by_num = {n: (gid, dl) for gid, n, dl, _ in gameweeks}
        gw_id, deadline = by_num[gw]
        gws = [g for g in range(gw, gw + HORIZON) if g in by_num]
        gid_to_num = {by_num[g][0]: g for g in gws}
        fixtures: dict[int, list[Fx]] = defaultdict(list)
        for r in self.fx[self.fx.gameweek_id.isin(list(gid_to_num)) & ~self.fx.status.isin(BAD)].itertuples():
            g = gid_to_num[int(r.gameweek_id)]
            dh = int(r.difficulty_home) if pd.notna(r.difficulty_home) else 3
            da = int(r.difficulty_away) if pd.notna(r.difficulty_away) else 3
            fixtures[int(r.home_team_id)].append(Fx(g, int(r.away_team_id), True, dh))
            fixtures[int(r.away_team_id)].append(Fx(g, int(r.home_team_id), False, da))
        season = self.st[self.st.season_id == sid]
        latest = season[season.kickoff_utc < deadline].groupby("player_id").tail(1).set_index("player_id")
        first = season[season.value_tenths.notna()].groupby("player_id").head(1).set_index("player_id")
        ps = self.ps[(self.ps.season_id == sid) & self.ps.fpl_position.notna()]
        ps = ps.sort_values(["player_id", "joined_on"], ascending=[True, False], na_position="last")
        players: dict[int, PInfo] = {}
        for r in ps.groupby("player_id").head(1).itertuples():
            pid = int(r.player_id)
            lt = latest.loc[pid] if pid in latest.index else None
            team = int(lt.team_id) if lt is not None and pd.notna(lt.team_id) else int(r.team_id)
            if lt is not None and pd.notna(lt.value_tenths) and lt.value_tenths:
                price = int(lt.value_tenths)
            else:
                price = int(first.loc[pid].value_tenths) if pid in first.index else 0
            if price:
                sel = int(lt.selected) if lt is not None and pd.notna(lt.selected) else 0
                players[pid] = PInfo(r.fpl_position, team, price, sel)
        st = self.st
        h = st[(st.kickoff_utc < deadline) & (st.status == "finished") & st.player_id.isin(list(players))]
        history: dict[int, list[tuple[int, int, bool]]] = {}
        ext: dict[int, pd.DataFrame] = {}
        for pid, grp in h.groupby("player_id").tail(HISTORY_ROWS).groupby("player_id"):
            grp = grp.iloc[::-1]
            pts = grp.total_points.fillna(0).astype(int)
            mins = grp.minutes.fillna(0).astype(int)
            history[int(pid)] = list(zip(pts, mins, grp.season_id == sid, strict=True))
            ext[int(pid)] = grp
        b = GwBundle(sid, gw, gw_id, deadline, gws, players, dict(fixtures), history)
        act = st[st.gameweek_id == gw_id].groupby("player_id")[["total_points", "minutes"]].sum()
        b.actual = {int(pid): (int(r.total_points), int(r.minutes)) for pid, r in act.iterrows()}
        b.ext = ext  # type: ignore[attr-defined]
        return b


def bundles(label: str) -> list[GwBundle]:
    cache = D / "cache" / f"{label.replace('/', '_')}.pkl"
    if cache.exists():
        return pickle.loads(cache.read_bytes())
    s = Store()
    sid = s.season_id(label)
    gwl = s.gameweeks(sid)
    out = [s.bundle(sid, n, gwl) for _, n, _, fin in gwl if fin and n >= MIN_GW]
    cache.parent.mkdir(exist_ok=True)
    cache.write_bytes(pickle.dumps(out))
    return out


def backtest(label: str, name: str, fn: Callable[[GwBundle], Any]) -> dict[str, float]:
    sim = SeasonSim()
    fh = 0
    sp = []
    for b in bundles(label):
        p = fn(b)
        pred, act = [], []
        for pid in b.players:
            x = p.get(pid, {}).get(b.gw, 0.0)
            pts, mins = b.actual.get(pid, (0, 0))
            if x > 0.05 or mins > 0:
                pred.append(x)
                act.append(float(pts))
        sp.append(metrics(pred, act)["spearman"])
        fh += free_hit_points({pid: v.get(b.gw, 0.0) for pid, v in p.items()}, b)[0]
        sim.step(p, b)
    return {"sim": sim.total, "fh": fh, "spearman": sum(sp) / len(sp), "hits": sim.hits}


_ENGINE: EngineData | None = None


def engine_data() -> EngineData:
    """Data engine v1 offline (dibuat sekali per proses)."""
    global _ENGINE
    if _ENGINE is None:
        s = Store()
        _ENGINE = EngineData(s.st, s.fx, s.rules)
    return _ENGINE


def _load_models(cand: str | None) -> dict[str, Callable[[GwBundle], Any]]:
    models: dict[str, Callable[[GwBundle], Any]] = {k: v for k, v in BASELINES.items()}
    for spec in SPECS:
        if spec.kind == "engine" and not spec.params.get("tactics"):
            models[spec.name] = lambda b, spec=spec: engine_model(
                b, spec, engine_data().context(b, spec.params)
            )
    if cand:
        spec = importlib.util.spec_from_file_location("cand", cand)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        models.update(mod.MODELS)
    return models


def _job(args: tuple[str, str, str | None]) -> tuple[str, str, dict[str, float]]:
    label, name, cand = args
    return label, name, backtest(label, name, _load_models(cand)[name])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("seasons")
    ap.add_argument("models")
    ap.add_argument("--cand")
    a = ap.parse_args()
    labels, names = a.seasons.split(","), a.models.split(",")
    for label in labels:
        bundles(label)  # bangun cache sekali sebelum paralel
    t = time.monotonic()
    with ProcessPoolExecutor() as ex:
        res = list(ex.map(_job, [(lb, n, a.cand) for lb in labels for n in names]))
    for label, name, r in sorted(res):
        print(
            f"{label} {name:20s} sim={r['sim']:5.0f} fh={r['fh']:5.0f} sp={r['spearman']:.3f} "
            f"hits={r['hits']}"
        )
    for name in names:
        tot = [r for _, n, r in res if n == name]
        print(f"TOTAL {name:20s} sim={sum(r['sim'] for r in tot):6.0f} fh={sum(r['fh'] for r in tot):6.0f}")
    print(f"({time.monotonic() - t:.0f}s)")


if __name__ == "__main__":
    main()
