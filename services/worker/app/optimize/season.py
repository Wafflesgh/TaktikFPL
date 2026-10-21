"""Rencana musim & chip (BLUEPRINT 5.4) — angka dari proyeksi engine, bukan LLM.

Masukan: xPts per pemain per GW untuk SEMUA GW tersisa, squad acuan (squad optimal 6 GW saat ini,
dianggap dipegang tanpa transfer), jumlah laga tiap tim per GW, dan jendela chip dari bootstrap-static.
Keluaran per GW: nilai XI/cadangan/kapten squad acuan, nilai Free Hit (squad terbaik GW itu saja),
nilai Wildcard (squad terbaik 6 GW mulai GW itu vs squad acuan), DGW/BGW — lalu GW terbaik tiap chip
di dalam jendelanya, lengkap dengan alasan berangka. Web memakai matriks yang sama untuk squad pengguna.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.optimize.squad import XI_MAX, XI_MIN, Candidate, best_xi, optimize_squad

DISCOUNT = 0.85
WC_HORIZON = 6
TOP_N = 3
CHIP_LABEL = {"wildcard": "Wildcard", "freehit": "Free Hit", "bboost": "Bench Boost", "3xc": "Triple Captain"}


@dataclass(frozen=True)
class XIPick:
    starters: list[int]
    bench: list[int]
    captain: int
    value: float  # jumlah xPts XI (kapten belum dikali dua)
    bench_value: float
    captain_value: float


def pick_xi(squad: list[int], value: dict[int, float], position: dict[int, str]) -> XIPick:
    """XI terbaik dari squad 15 dengan formasi FPL yang valid (enumerasi formasi, tanpa ILP)."""
    by_pos: dict[str, list[int]] = {pos: [] for pos in XI_MIN}
    for pid in squad:
        by_pos.setdefault(position[pid], []).append(pid)
    for pos in by_pos:
        by_pos[pos].sort(key=lambda p: value.get(p, 0.0), reverse=True)
    best: list[int] = []
    best_v = float("-inf")
    for d in range(XI_MIN["DEF"], XI_MAX["DEF"] + 1):
        for m in range(XI_MIN["MID"], XI_MAX["MID"] + 1):
            f = 10 - d - m
            if not XI_MIN["FWD"] <= f <= XI_MAX["FWD"]:
                continue
            if len(by_pos["DEF"]) < d or len(by_pos["MID"]) < m or len(by_pos["FWD"]) < f:
                continue
            xi = by_pos["GKP"][:1] + by_pos["DEF"][:d] + by_pos["MID"][:m] + by_pos["FWD"][:f]
            v = sum(value.get(p, 0.0) for p in xi)
            if v > best_v:
                best, best_v = xi, v
    bench = [p for p in squad if p not in best]
    captain = max(best, key=lambda p: value.get(p, 0.0)) if best else 0
    return XIPick(
        starters=best,
        bench=bench,
        captain=captain,
        value=round(max(best_v, 0.0), 2),
        bench_value=round(sum(value.get(p, 0.0) for p in bench), 2),
        captain_value=round(value.get(captain, 0.0), 2),
    )


def horizon_values(
    xpts: dict[int, dict[int, float]], start: int, last_gw: int, n: int = WC_HORIZON
) -> dict[int, float]:
    end = min(last_gw, start + n - 1)
    return {
        pid: sum(gws.get(g, 0.0) * DISCOUNT ** (g - start) for g in range(start, end + 1))
        for pid, gws in xpts.items()
    }


@dataclass
class SeasonInput:
    first_gw: int
    last_gw: int
    xpts: dict[int, dict[int, float]]  # pemain → GW → xPts (jumlah laga GW itu)
    position: dict[int, str]
    team: dict[int, int]
    price: dict[int, int]
    name: dict[int, str]
    team_short: dict[int, str]
    fixtures_per_team: dict[int, dict[int, int]]  # GW → tim → jumlah laga
    template: list[int]  # squad acuan 15 pemain
    chips: list[dict[str, Any]]  # {name, number, start_event, stop_event}
    budget_tenths: int = 1000
    max_per_team: int = 3


def _candidates(inp: SeasonInput, value: dict[int, float]) -> list[Candidate]:
    return [
        Candidate(pid, inp.position[pid], inp.team[pid], inp.price[pid], round(value.get(pid, 0.0), 3))
        for pid in inp.xpts
        if pid in inp.position and inp.price.get(pid)
    ]


def gw_rows(inp: SeasonInput, solve: Callable[..., Any] = best_xi) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    teams = set(inp.team.values())
    for g in range(inp.first_gw, inp.last_gw + 1):
        val = {pid: gws.get(g, 0.0) for pid, gws in inp.xpts.items()}
        counts = inp.fixtures_per_team.get(g, {})
        tpl = pick_xi(inp.template, val, inp.position)
        fh = solve(_candidates(inp, val), budget_tenths=inp.budget_tenths, max_per_team=inp.max_per_team)
        fh_total = fh.value + max((val.get(p, 0.0) for p in fh.starters), default=0.0)
        tpl_total = tpl.value + tpl.captain_value
        rows.append(
            {
                "gw": g,
                "dgw": sorted(inp.team_short.get(t, "?") for t, n in counts.items() if n >= 2),
                "bgw": sorted(inp.team_short.get(t, "?") for t in teams if counts.get(t, 0) == 0),
                "template_xi": tpl.value,
                "template_bench": tpl.bench_value,
                "template_captain": {
                    "id": tpl.captain,
                    "name": inp.name.get(tpl.captain, "?"),
                    "xpts": tpl.captain_value,
                },
                "fh_xi": round(fh.value, 2),
                "fh_total": round(fh_total, 2),  # XI + kapten (dikali dua)
                "fh_gain": round(fh_total - tpl_total, 2),
                "fh_squad": fh.starters + fh.bench,
            }
        )
    return rows


def free_transfer_value(inp: SeasonInput) -> float:
    """Nilai 1 free transfer: gain horizon 6 GW dari transfer tunggal terbaik squad acuan saat ini
    (posisi sama, harga tidak lebih mahal, batas klub). Dipakai agar Wildcard tidak dinilai terhadap
    squad yang dianggap tidak pernah ditransfer."""
    hv = horizon_values(inp.xpts, inp.first_gw, inp.last_gw)
    clubs: dict[int, int] = {}
    for p in inp.template:
        clubs[inp.team[p]] = clubs.get(inp.team[p], 0) + 1
    owned = set(inp.template)
    best = 0.0
    for out in inp.template:
        for pid in inp.xpts:
            if pid in owned or inp.position.get(pid) != inp.position[out]:
                continue
            if inp.price.get(pid, 10**6) > inp.price[out]:
                continue
            if clubs.get(inp.team[pid], 0) + (0 if inp.team[pid] == inp.team[out] else 1) > inp.max_per_team:
                continue
            best = max(best, hv.get(pid, 0.0) - hv.get(out, 0.0))
    return round(best, 2)


def wildcard_rows(
    inp: SeasonInput, gws: list[int], solve: Callable[..., Any] = optimize_squad
) -> dict[int, dict[str, float]]:
    """Squad terbaik 6 GW mulai g vs squad acuan dengan metrik sama (XI terbaik dari nilai horizon)."""
    out: dict[int, dict[str, float]] = {}
    ft_value = free_transfer_value(inp) if gws else 0.0
    for g in gws:
        hv = horizon_values(inp.xpts, g, inp.last_gw)
        opt = solve(_candidates(inp, hv), budget_tenths=inp.budget_tenths, max_per_team=inp.max_per_team)
        tpl = pick_xi(inp.template, hv, inp.position)
        raw = opt.value_xi - tpl.value
        # Tanpa Wildcard, 1 free transfer per GW tetap memperbaiki squad acuan.
        recovered = ft_value * (g - inp.first_gw)
        out[g] = {
            "opt6": round(opt.value_xi, 2),
            "template6": tpl.value,
            "raw_gain": round(raw, 2),
            "ft_value": ft_value,
            "gain": round(raw - recovered, 2),
        }
    return out


def _window(chip: dict[str, Any], first_gw: int) -> list[int]:
    return list(range(max(first_gw, int(chip["start_event"])), int(chip["stop_event"]) + 1))


def chip_plan(
    inp: SeasonInput, rows: list[dict[str, Any]], wc: dict[int, dict[str, float]]
) -> list[dict[str, Any]]:
    by_gw = {r["gw"]: r for r in rows}
    plan: list[dict[str, Any]] = []
    for chip in sorted(inp.chips, key=lambda c: (int(c["start_event"]), c["name"])):
        window = [g for g in _window(chip, inp.first_gw) if g in by_gw]
        if not window:
            continue  # jendela sudah lewat
        name = chip["name"]
        scored: list[tuple[float, int, str]] = []
        for g in window:
            r = by_gw[g]
            dgw = f"; DGW for {', '.join(r['dgw'][:6])}" if r["dgw"] else ""
            bgw = f"; {len(r['bgw'])} teams blank" if r["bgw"] else ""
            if name == "3xc":
                c = r["template_captain"]
                scored.append(
                    (
                        c["xpts"],
                        g,
                        f"{c['name']} projected {c['xpts']:.1f} xPts (+{c['xpts']:.1f} from the chip){dgw}",
                    )
                )
            elif name == "bboost":
                scored.append(
                    (r["template_bench"], g, f"bench projected {r['template_bench']:.1f} xPts{dgw}")
                )
            elif name == "freehit":
                scored.append(
                    (
                        r["fh_gain"],
                        g,
                        f"one-week squad beats the held squad by {r['fh_gain']:+.1f} xPts{bgw}{dgw}",
                    )
                )
            elif name == "wildcard" and g in wc:
                w = wc[g]
                scored.append(
                    (
                        w["gain"],
                        g,
                        f"best 6-GW squad from GW{g}: {w['opt6']:.1f} vs held {w['template6']:.1f} "
                        f"({w['raw_gain']:+.1f}); net {w['gain']:+.1f} after the free transfers you'd "
                        f"make anyway (~{w['ft_value']:.1f} xPts each)",
                    )
                )
        if not scored:
            continue
        scored.sort(key=lambda s: (-s[0], s[1]))
        best = [{"gw": g, "value": round(v, 2), "text": t} for v, g, t in scored[:TOP_N]]
        runner_up = scored[1][0] if len(scored) > 1 else None
        margin = None if runner_up is None else round(scored[0][0] - runner_up, 2)
        plan.append(
            {
                "name": name,
                "label": CHIP_LABEL.get(name, name),
                "number": int(chip.get("number") or 1),
                "start_event": int(chip["start_event"]),
                "stop_event": int(chip["stop_event"]),
                "recommended_gw": best[0]["gw"],
                "margin_vs_next": margin,
                "best": best,
            }
        )
    return plan


def plan_season(inp: SeasonInput) -> dict[str, Any]:
    rows = gw_rows(inp)
    wc_gws = sorted(
        {g for c in inp.chips if c["name"] == "wildcard" for g in _window(c, inp.first_gw)}
        & {r["gw"] for r in rows}
    )
    wc = wildcard_rows(inp, wc_gws)
    for r in rows:
        if r["gw"] in wc:
            r["wc"] = wc[r["gw"]]
    return {
        "first_gw": inp.first_gw,
        "last_gw": inp.last_gw,
        "template": inp.template,
        "gws": rows,
        "chips": chip_plan(inp, rows, wc),
        # Matriks xPts (2 desimal) agar web bisa menghitung rencana untuk squad pengguna sendiri.
        "matrix": {
            str(pid): [round(gws.get(g, 0.0), 2) for g in range(inp.first_gw, inp.last_gw + 1)]
            for pid, gws in inp.xpts.items()
            if any(v > 0.05 for v in gws.values())
        },
    }
