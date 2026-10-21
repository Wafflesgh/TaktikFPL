"""Rencana musim & chip: XI dari squad 15, DGW/BGW, dan GW terbaik tiap chip di jendelanya."""

from app.optimize.season import SeasonInput, chip_plan, gw_rows, pick_xi, plan_season


def squad15():
    pos = ["GKP"] * 2 + ["DEF"] * 5 + ["MID"] * 5 + ["FWD"] * 3
    return {i + 1: p for i, p in enumerate(pos)}


def test_pick_xi_valid_formation_and_bench():
    position = squad15()
    value = {pid: float(pid) for pid in position}  # FWD (13–15) paling tinggi
    xi = pick_xi(list(position), value, position)
    assert len(xi.starters) == 11 and len(xi.bench) == 4
    cnt = {p: sum(1 for s in xi.starters if position[s] == p) for p in ("GKP", "DEF", "MID", "FWD")}
    assert cnt["GKP"] == 1 and cnt["DEF"] >= 3 and cnt["MID"] >= 2 and cnt["FWD"] <= 3
    assert xi.captain == 15 and xi.captain_value == 15.0
    assert xi.bench_value == round(sum(value[p] for p in xi.bench), 2)


def make_input(chips):
    # 40 pemain, 20 tim; squad acuan = 15 pemain pertama; GW 10–13.
    pos_cycle = ["GKP", "DEF", "DEF", "MID", "MID", "MID", "FWD", "DEF"]
    position = {pid: pos_cycle[pid % len(pos_cycle)] for pid in range(1, 41)}
    team = {pid: 1 + pid % 20 for pid in position}
    price = {pid: 45 for pid in position}
    xpts = {pid: {g: 2.0 + (pid % 5) * 0.3 for g in range(10, 14)} for pid in position}
    # GW12: tim 1 & 2 DGW → pemainnya dobel; GW11: tim 3 blank.
    for pid in position:
        if team[pid] in (1, 2):
            xpts[pid][12] *= 2
        if team[pid] == 3:
            xpts[pid][11] = 0.0
    fixtures = {g: {t: 1 for t in range(1, 21)} for g in range(10, 14)}
    fixtures[12][1] = fixtures[12][2] = 2
    fixtures[11][3] = 0
    gk = [p for p in position if position[p] == "GKP"][:2]
    df = [p for p in position if position[p] == "DEF"][:5]
    md = [p for p in position if position[p] == "MID"][:5]
    fw = [p for p in position if position[p] == "FWD"][:3]
    return SeasonInput(
        first_gw=10,
        last_gw=13,
        xpts=xpts,
        position=position,
        team=team,
        price=price,
        name={p: f"P{p}" for p in position},
        team_short={t: f"T{t}" for t in range(1, 21)},
        fixtures_per_team=fixtures,
        template=gk + df + md + fw,
        chips=chips,
    )


def test_gw_rows_flags_double_and_blank():
    rows = {r["gw"]: r for r in gw_rows(make_input([]))}
    assert rows[12]["dgw"] == ["T1", "T2"]
    assert rows[11]["bgw"] == ["T3"]
    assert rows[10]["fh_gain"] >= 0  # squad sekali pakai tidak pernah lebih buruk dari squad acuan
    assert len(rows[10]["fh_squad"]) == 15


def test_chips_pick_double_gameweek_inside_window_only():
    chips = [
        {"name": "3xc", "number": 1, "start_event": 1, "stop_event": 19},
        {"name": "bboost", "number": 1, "start_event": 1, "stop_event": 11},  # jendela berakhir sebelum DGW
        {"name": "wildcard", "number": 1, "start_event": 2, "stop_event": 9},  # sudah lewat
    ]
    inp = make_input(chips)
    rows = gw_rows(inp)
    plan = {c["name"]: c for c in chip_plan(inp, rows, {})}
    assert "wildcard" not in plan
    assert plan["bboost"]["recommended_gw"] in (10, 11)
    tc = plan["3xc"]
    # Rekomendasi Triple Captain = GW dengan xPts kapten squad acuan tertinggi.
    best_val = max(r["template_captain"]["xpts"] for r in rows)
    assert tc["best"][0]["value"] == best_val
    assert "xPts" in tc["best"][0]["text"]


def test_plan_season_includes_wildcard_and_matrix():
    chips = [{"name": "wildcard", "number": 1, "start_event": 2, "stop_event": 19}]
    out = plan_season(make_input(chips))
    wc = out["chips"][0]
    assert wc["label"] == "Wildcard" and 10 <= wc["recommended_gw"] <= 13
    assert all("wc" in r for r in out["gws"])
    assert len(next(iter(out["matrix"].values()))) == 4
