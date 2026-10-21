"""Alasan pemilihan pemain (template deterministik) + XI terbaik satu GW."""

from app.models.reasons import FixtureView, player_reasons
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


def test_max_four_reasons():
    form = {"form_label": "panas", "points_per_match": 9, "pct_underlying_pos": 0.95}
    fixtures = [fx(8, att=1.3), fx(8, att=1.2)] + [fx(g, att=1.3) for g in range(9, 14)]
    assert len(player_reasons("MID", "d", 75, "knock", form, fixtures, 8)) == 4


def test_best_xi_valid_formation_and_club_limit():
    cands = []
    pid = 0
    for pos, n in (("GKP", 3), ("DEF", 8), ("MID", 8), ("FWD", 5)):
        for i in range(n):
            pid += 1
            # klub 1 punya pemain terbaik di semua posisi → batas 3 per klub harus berlaku
            cands.append(Candidate(pid, pos, 1 if i < 2 else 10 + pid, 50, 10.0 - i))
    xi = best_xi(cands)
    assert xi.status == "Optimal" and len(xi.starters) == 11
    by = {c.player_id: c for c in cands}
    assert sum(1 for p in xi.starters if by[p].team_id == 1) <= 3
    assert sum(1 for p in xi.starters if by[p].position == "GKP") == 1
    d, m, f = (int(x) for x in xi.formation.split("-"))
    assert d + m + f == 10 and 3 <= d <= 5 and 2 <= m <= 5 and 1 <= f <= 3
    assert by[xi.captain].value >= by[xi.vice].value
