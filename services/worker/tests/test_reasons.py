"""Alasan pemilihan pemain (template deterministik) + XI terbaik satu GW."""

from app.models.reasons import MAX_REASONS, FixtureView, player_reasons
from app.optimize.squad import Candidate, best_xi


def fx(gw, opp="ABC", home=True, xmins=88.0, att=1.0, cs=0.3):
    return FixtureView(gw, opp, home, xmins, att, cs)


def kinds(rs):
    return [(r["kind"], r["tone"]) for r in rs]


def test_hot_form_easy_fixture_nailed():
    form = {"form_label": "panas", "points_per_match": 8.25, "pct_underlying_pos": 0.5}
    rs = player_reasons("MID", "a", None, None, form, [fx(8, "SHU", att=1.3), fx(9)], 8)
    assert ("fixture", "good") in kinds(rs)
    assert any(r["text"].startswith("Hot form: 8.2") for r in rs)
    assert ("minutes", "good") in kinds(rs)
    assert "SHU (H)" in next(r["text"] for r in rs if r["kind"] == "fixture")


def test_injury_doubt_shown_first():
    rs = player_reasons("FWD", "d", 75, "Hamstring injury", None, [fx(8)], 8)
    assert rs[0]["kind"] == "availability" and rs[0]["tone"] == "warn"
    assert "75%" in rs[0]["text"] and "Hamstring" in rs[0]["text"]


def test_unavailable_is_bad_and_no_minutes_claim():
    rs = player_reasons("DEF", "i", 0, "Knee injury - expected back late Nov", None, [fx(8)], 8)
    assert rs[0]["tone"] == "bad"
    assert "minutes" not in [r["kind"] for r in rs]


def test_tough_now_easier_run_after():
    # Kasus Bruno: GW depan sulit, 3 laga sesudahnya mudah.
    fixtures = [fx(8, "MCI", att=0.7), fx(9, "BUR", att=1.3), fx(10, "SHU", att=1.25), fx(11, "LUT", att=1.2)]
    rs = player_reasons("MID", "a", None, None, None, fixtures, 8)
    assert ("fixture", "warn") in kinds(rs)
    run = next(r for r in rs if r["kind"] == "run")
    assert run["text"].startswith("Easier run after this GW: 3 of next 3")


def test_defender_uses_clean_sheet_chance():
    rs = player_reasons("DEF", "a", None, None, None, [fx(8, "IPS", cs=0.48)], 8)
    assert "48% clean-sheet chance vs IPS (H)" in rs[0]["text"]


def test_double_gameweek_and_blank():
    assert player_reasons("MID", "a", None, None, None, [fx(8), fx(8, "XYZ")], 8)[0]["kind"] == "dgw"
    assert player_reasons("MID", "a", None, None, None, [fx(9)], 8)[0]["tone"] == "bad"


def test_reasons_capped():
    form = {"form_label": "panas", "points_per_match": 9, "pct_underlying_pos": 0.95}
    fixtures = [fx(8, att=1.3), fx(8, att=1.2)] + [fx(g, att=1.3) for g in range(9, 14)]
    assert len(player_reasons("MID", "d", 75, "knock", form, fixtures, 8)) <= MAX_REASONS


def test_best_xi_fits_budget_with_bench():
    cands = []
    pid = 0
    for pos, n in (("GKP", 4), ("DEF", 10), ("MID", 10), ("FWD", 6)):
        for i in range(n):
            pid += 1
            # pemain terbaik mahal; klub 1 punya yang terbaik di semua posisi → batas 3/klub berlaku
            cands.append(
                Candidate(pid, pos, 1 if i < 2 else 10 + pid, 130 - i * 10 if i < 5 else 40, 10.0 - i)
            )
    xi = best_xi(cands, budget_tenths=1000)
    by = {c.player_id: c for c in cands}
    assert xi.status == "Optimal" and len(xi.starters) == 11 and len(xi.bench) == 4
    assert xi.cost_tenths <= 1000
    assert sum(1 for p in xi.starters + xi.bench if by[p].team_id == 1) <= 3
    assert by[xi.bench[0]].position == "GKP"
    d, m, f = (int(x) for x in xi.formation.split("-"))
    assert d + m + f == 10 and 3 <= d <= 5 and 2 <= m <= 5 and 1 <= f <= 3
    assert by[xi.captain].value >= by[xi.vice].value


def test_reasons_carry_percentages():
    f = FixtureView(
        8,
        "SHU",
        True,
        86.0,
        1.3,
        0.3,
        xgi=0.79,
        xg=0.48,
        xa=0.31,
        p60=0.92,
        p_goal=0.38,
        p_assist=0.27,
        lam_team=2.1,
    )
    form = {"form_label": "panas", "points_per_match": 8.2, "pct_points_pos": 0.96}
    texts = " | ".join(r["text"] for r in player_reasons("MID", "a", None, None, form, [f], 8))
    assert "38% to score, 27% to assist" in texts
    assert "expected 2.1 goals" in texts
    assert "92% to play 60+" in texts
    assert "top 4% of MIDs" in texts


def test_defender_picked_for_defcon_and_threat():
    f = FixtureView(8, "NEW", True, 90.0, 1.0, 0.2, xgi=0.3, defcon_pts=1.2)
    rs = player_reasons("DEF", "a", None, None, None, [f], 8)
    ks = [r["kind"] for r in rs]
    assert "defcon" in ks and "threat" in ks


def test_low_block_and_role_reasons():
    f = FixtureView(
        8,
        "BUR",
        True,
        88.0,
        1.1,
        0.3,
        opp_style="low_block",
        opp_ppda=15.2,
        opp_rank_passive=2,
        opp_n_teams=20,
    )
    tactics = {
        "xgi90": 0.55,
        "split": {"low_block": {"minutes": 1240, "xgi90": 0.71, "shrunk": 0.66, "ratio": 1.2}},
        "primary_role": "AMR",
        "roles": {"AMR": 0.85, "FWR": 0.15},
        "starts": 20,
        "set_piece_xg_share": 0.3,
    }
    rs = {r["kind"]: r for r in player_reasons("MID", "a", None, None, None, [f], 8, tactics)}
    assert "2nd most passive of 20" in rs["style"]["text"] and "+20%" in rs["style"]["text"]
    assert rs["style"]["tone"] == "good"
    assert rs["role"]["text"].startswith("Role: right winger (AMR) in 85% of last 20 starts")
    assert "30% of xG from set pieces" in rs["role"]["text"]
