"""Simulasi "poin akhir" per model — mengubah prediksi menjadi keputusan FPL lalu menilai dengan poin asli.

- Weekly Free Hit: tiap GW squad £100m terbaik menurut model untuk GW itu saja → murni kualitas ranking.
- Season sim: squad awal £100m (nilai 6 GW), tiap GW +1 free transfer (maks 5), transfer greedy bila
  untung (hit −4 hanya bila gain jelas > 4), kapten = xPts tertinggi. Paling mirip bermain sungguhan.
Keduanya memakai autosub sederhana (pemain 0 menit diganti cadangan sesuai urutan & formasi).
Penyederhanaan: harga jual = harga sekarang; tanpa chip.
"""

from dataclasses import dataclass, field

from app.lab.data import GwBundle
from app.optimize.season import pick_xi
from app.optimize.squad import XI_MAX, XI_MIN, Candidate, best_xi, optimize_squad

HIT_COST = 4
MAX_FT = 5
FT_MIN_GAIN = 0.5  # gain horizon minimum agar free transfer dipakai
HIT_MIN_GAIN = HIT_COST + 1.0
DISCOUNT = 0.85


def _valid(xi: list[int], position: dict[int, str]) -> bool:
    cnt = {p: sum(1 for x in xi if position[x] == p) for p in XI_MIN}
    return all(XI_MIN[p] <= cnt[p] <= XI_MAX[p] for p in XI_MIN)


def score_xi(
    starters: list[int], bench: list[int], captain: int, vice: int, b: GwBundle, position: dict[int, str]
) -> tuple[int, list[int]]:
    """Poin asli GW dengan autosub + kapten ×2 (vice bila kapten tidak main)."""
    mins = {pid: b.actual.get(pid, (0, 0))[1] for pid in starters + bench}
    xi = list(starters)
    used: set[int] = set()
    for i, pid in enumerate(list(xi)):
        if mins[pid] > 0:
            continue
        for sub in bench:
            if sub in used or mins[sub] == 0:
                continue
            if (position[sub] == "GKP") != (position[pid] == "GKP"):
                continue
            trial = xi[:i] + [sub] + xi[i + 1 :]
            if _valid(trial, position):
                xi, used = trial, used | {sub}
                break
    pts = sum(b.actual.get(pid, (0, 0))[0] for pid in xi)
    cap = captain if mins.get(captain, 0) > 0 else vice if mins.get(vice, 0) > 0 else 0
    if cap in xi:
        pts += b.actual.get(cap, (0, 0))[0]
    return pts, xi


def free_hit_points(pred_gw: dict[int, float], b: GwBundle) -> tuple[int, int]:
    """(poin, kapten) squad £100m terbaik untuk GW ini menurut model."""
    cands = [
        Candidate(pid, info.position, info.team, info.price, round(pred_gw.get(pid, 0.0), 3))
        for pid, info in b.players.items()
        if pred_gw.get(pid, 0.0) > 0
    ]
    plan = best_xi(cands, budget_tenths=1000, max_per_team=3)
    position = {pid: info.position for pid, info in b.players.items()}
    pts, _ = score_xi(plan.starters, plan.bench, plan.captain, plan.vice, b, position)
    return pts, plan.captain


def horizon_value(pred: dict[int, float], first: int) -> float:
    return sum(x * DISCOUNT ** (g - first) for g, x in pred.items())


@dataclass
class SeasonSim:
    squad: list[int] = field(default_factory=list)
    bank: int = 0
    ft: int = 1
    total: int = 0
    hits: int = 0
    transfers: int = 0
    log: list[dict[str, object]] = field(default_factory=list)

    def step(self, preds: dict[int, dict[int, float]], b: GwBundle) -> int:
        position = {pid: info.position for pid, info in b.players.items()}
        hv = {pid: horizon_value(p, b.gw) for pid, p in preds.items()}
        made: list[tuple[int, int]] = []
        hits = 0
        if not self.squad:
            cands = [
                Candidate(pid, info.position, info.team, info.price, round(hv.get(pid, 0.0), 3))
                for pid, info in b.players.items()
                if hv.get(pid, 0.0) > 0
            ]
            plan = optimize_squad(cands)
            self.squad = list(plan.squad)
            self.bank = 1000 - plan.cost_tenths
            self.ft = 1
        else:
            self.ft = min(MAX_FT, self.ft + 1)
            # Pemain yang keluar dari liga: tetap di squad dengan nilai 0 (akan dijual pertama).
            for p in self.squad:
                position.setdefault(p, "MID")
            for _ in range(self.ft + 1):
                best = self._best_transfer(hv, b, position)
                if best is None:
                    break
                gain, out_p, in_p = best
                use_hit = self.ft <= 0
                if gain < (HIT_MIN_GAIN if use_hit else FT_MIN_GAIN):
                    break
                out_price = b.players[out_p].price if out_p in b.players else 0
                self.bank += out_price - b.players[in_p].price
                self.squad = [in_p if p == out_p else p for p in self.squad]
                made.append((out_p, in_p))
                if use_hit:
                    hits += 1
                else:
                    self.ft -= 1
        val = {pid: preds.get(pid, {}).get(b.gw, 0.0) for pid in self.squad}
        pick = pick_xi(self.squad, val, position)
        order = sorted(pick.starters, key=lambda p: val.get(p, 0.0), reverse=True)
        bench = sorted(pick.bench, key=lambda p: (position[p] != "GKP", -val.get(p, 0.0)))
        pts, _ = score_xi(pick.starters, bench, order[0], order[1] if len(order) > 1 else 0, b, position)
        pts -= HIT_COST * hits
        self.total += pts
        self.hits += hits
        self.transfers += len(made)
        self.log.append(
            {"gw": b.gw, "points": pts, "hits": hits, "transfers": made, "captain": order[0] if order else 0}
        )
        return pts

    def _best_transfer(
        self, hv: dict[int, float], b: GwBundle, position: dict[int, str]
    ) -> tuple[float, int, int] | None:
        clubs: dict[int, int] = {}
        for p in self.squad:
            if p in b.players:
                clubs[b.players[p].team] = clubs.get(b.players[p].team, 0) + 1
        owned = set(self.squad)
        best: tuple[float, int, int] | None = None
        ranked = sorted(
            ((v, pid) for pid, v in hv.items() if pid not in owned and pid in b.players), reverse=True
        )[:150]
        for out_p in self.squad:
            out_info = b.players.get(out_p)
            budget = self.bank + (out_info.price if out_info else 0)
            for v, pid in ranked:
                info = b.players[pid]
                if info.position != position[out_p] or info.price > budget:
                    continue
                same = out_info is not None and out_info.team == info.team
                if clubs.get(info.team, 0) + (0 if same else 1) > 3:
                    continue
                gain = v - hv.get(out_p, 0.0)
                if best is None or gain > best[0]:
                    best = (gain, out_p, pid)
                break  # ranked menurun: kandidat pertama yang lolos adalah terbaik untuk out_p ini
        return best
