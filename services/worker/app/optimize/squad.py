"""Optimizer squad dari nol (wildcard/awal musim) — Integer Linear Programming (PuLP), BLUEPRINT 5.4.

Memaksimalkan nilai horizon (xPts beberapa GW, terdiskon) dengan kendala FPL yang dibaca dari data:
budget, jumlah per posisi, maksimal pemain per klub, dan formasi XI yang valid. Starter dihitung
penuh, cadangan dengan bobot kecil (hanya terpakai bila ada autosub).
"""

from dataclasses import dataclass

import pulp

# Komposisi squad & aturan formasi FPL (dibaca dari bootstrap-static game_settings / element_types
# bila tersedia; nilai di sini default musim 2026/27).
SQUAD_SIZE = {"GKP": 2, "DEF": 5, "MID": 5, "FWD": 3}
XI_MIN = {"GKP": 1, "DEF": 3, "MID": 2, "FWD": 1}
XI_MAX = {"GKP": 1, "DEF": 5, "MID": 5, "FWD": 3}
BENCH_WEIGHT = 0.1


@dataclass(frozen=True)
class Candidate:
    player_id: int
    position: str
    team_id: int
    price_tenths: int
    value: float  # xPts horizon terdiskon


@dataclass(frozen=True)
class SquadPlan:
    squad: list[int]
    starters: list[int]
    captain: int
    cost_tenths: int
    value_xi: float
    status: str


def optimize_squad(
    candidates: list[Candidate],
    budget_tenths: int = 1000,
    max_per_team: int = 3,
    squad_size: dict[str, int] | None = None,
) -> SquadPlan:
    sizes = squad_size or SQUAD_SIZE
    prob = pulp.LpProblem("squad", pulp.LpMaximize)
    # PuLP 4: variabel dibuat lewat problem.add_variable
    pick = {c.player_id: prob.add_variable(f"s_{c.player_id}", cat="Binary") for c in candidates}
    start = {c.player_id: prob.add_variable(f"x_{c.player_id}", cat="Binary") for c in candidates}

    prob += pulp.lpSum(
        c.value * start[c.player_id] + BENCH_WEIGHT * c.value * (pick[c.player_id] - start[c.player_id])
        for c in candidates
    )
    prob += pulp.lpSum(c.price_tenths * pick[c.player_id] for c in candidates) <= budget_tenths
    for pos, n in sizes.items():
        prob += pulp.lpSum(pick[c.player_id] for c in candidates if c.position == pos) == n
        prob += pulp.lpSum(start[c.player_id] for c in candidates if c.position == pos) >= XI_MIN[pos]
        prob += pulp.lpSum(start[c.player_id] for c in candidates if c.position == pos) <= XI_MAX[pos]
    prob += pulp.lpSum(start.values()) == 11
    for c in candidates:
        prob += start[c.player_id] <= pick[c.player_id]
    for team in {c.team_id for c in candidates}:
        prob += pulp.lpSum(pick[c.player_id] for c in candidates if c.team_id == team) <= max_per_team

    stats = prob.solve(pulp.HiGHS(msg=False, timeLimit=60))
    status = stats.status.name  # "Optimal", "Infeasible", ...
    by_id = {c.player_id: c for c in candidates}
    squad = [pid for pid, v in pick.items() if (v.value() or 0) > 0.5]
    starters = [pid for pid, v in start.items() if (v.value() or 0) > 0.5]
    captain = max(starters, key=lambda pid: by_id[pid].value) if starters else 0
    return SquadPlan(
        squad=squad,
        starters=starters,
        captain=captain,
        cost_tenths=sum(by_id[p].price_tenths for p in squad),
        value_xi=round(sum(by_id[p].value for p in starters), 2),
        status=status,
    )


@dataclass(frozen=True)
class XIPlan:
    starters: list[int]
    captain: int
    vice: int
    formation: str  # mis. "3-4-3"
    value: float
    status: str


def best_xi(candidates: list[Candidate], max_per_team: int = 3) -> XIPlan:
    """XI terbaik satu GW (tanpa budget): formasi valid + maks pemain per klub. `value` = xPts GW itu."""
    prob = pulp.LpProblem("xi", pulp.LpMaximize)
    start = {c.player_id: prob.add_variable(f"x_{c.player_id}", cat="Binary") for c in candidates}
    prob += pulp.lpSum(c.value * start[c.player_id] for c in candidates)
    prob += pulp.lpSum(start.values()) == 11
    for pos in XI_MIN:
        n = pulp.lpSum(start[c.player_id] for c in candidates if c.position == pos)
        prob += n >= XI_MIN[pos]
        prob += n <= XI_MAX[pos]
    for team in {c.team_id for c in candidates}:
        prob += pulp.lpSum(start[c.player_id] for c in candidates if c.team_id == team) <= max_per_team
    stats = prob.solve(pulp.HiGHS(msg=False, timeLimit=30))
    by_id = {c.player_id: c for c in candidates}
    starters = [pid for pid, v in start.items() if (v.value() or 0) > 0.5]
    ranked = sorted(starters, key=lambda pid: by_id[pid].value, reverse=True)
    count = {pos: sum(1 for p in starters if by_id[p].position == pos) for pos in ("DEF", "MID", "FWD")}
    return XIPlan(
        starters=starters,
        captain=ranked[0] if ranked else 0,
        vice=ranked[1] if len(ranked) > 1 else 0,
        formation=f"{count['DEF']}-{count['MID']}-{count['FWD']}",
        value=round(sum(by_id[p].value for p in starters), 2),
        status=stats.status.name,
    )
