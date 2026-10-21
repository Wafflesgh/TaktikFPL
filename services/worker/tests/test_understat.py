"""Adapter Understat: parser (fixture JSON nyata yang dipangkas) dan pencocokan tim/laga/pemain."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.features.tactics import PlayerTactics, TeamStyle, percentile
from app.sources.understat import (
    UMatch,
    match_fixture,
    match_player,
    match_teams,
    name_similarity,
    parse_match,
    parse_matches,
    parse_team_history,
    season_year,
)

FIX = Path(__file__).parent / "fixtures" / "understat"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def test_parse_league():
    league = load("league.json")
    matches = parse_matches(league)
    done = [m for m in matches if m.is_result]
    assert done and done[0].kickoff_utc.tzinfo is UTC
    assert done[0].home_goals is not None and done[0].home_xg is not None
    assert any(not m.is_result and m.home_goals is None for m in matches)
    hist = parse_team_history(league)
    assert hist and all(h.ppda is None or h.ppda > 0 for h in hist)
    assert season_year("2026/27") == 2026


def test_parse_match_rosters_and_shots():
    rosters, shots = parse_match(load("match.json"), 31180)
    assert any(r.is_home for r in rosters) and any(not r.is_home for r in rosters)
    gk = next(r for r in rosters if r.position == "GK")
    assert gk.position_order == 1 and gk.minutes > 0
    assert shots and {s.situation for s in shots} <= {
        "OpenPlay",
        "FromCorner",
        "SetPiece",
        "DirectFreekick",
        "Penalty",
    }
    assert all(0 <= s.x <= 1 and 0 <= s.y <= 1 for s in shots)


def test_match_teams_by_schedule_without_names():
    t0 = datetime(2026, 8, 21, 19, tzinfo=UTC)
    um = [
        UMatch(1, 83, 294, "Arsenal", "Coventry", t0, True, 3, 0, 1.8, 0.5),
        UMatch(2, 294, 83, "Coventry", "Arsenal", t0 + timedelta(days=7), True, 0, 1, 0.4, 1.2),
        UMatch(3, 83, 71, "Arsenal", "Aston Villa", t0 + timedelta(days=14), True, 1, 1, 1.0, 1.0),
    ]
    ours = [
        (10, 20, t0),
        (20, 10, t0 + timedelta(days=7, hours=1)),
        (10, 30, t0 + timedelta(days=14)),
    ]
    tm = match_teams(um, ours)
    assert tm[83] == 10 and tm[294] == 20
    assert 71 not in tm  # hanya 1 laga → belum cukup bukti
    fx = [(100, 10, 20, t0), (101, 20, 10, t0 + timedelta(days=7))]
    assert match_fixture(um[0], tm, fx) == 100
    assert match_fixture(um[1], tm, fx) == 101


def test_player_matching_name_and_minutes():
    assert name_similarity("Gabriel Magalhães", "Gabriel dos Santos Magalhães") >= 0.8
    assert name_similarity("Martin Odegaard", "Martin Ødegaard") > 0.8
    cands = [
        (1, "Bukayo Saka", "Saka", 90),
        (2, "Ethan Nwaneri", "Nwaneri", 12),
        (3, "Leandro Trossard", "Trossard", 78),
    ]
    pid, score = match_player("Bukayo Saka", 90, cands)
    assert pid == 1 and score >= 0.95
    pid, score = match_player("Some Unknown", 45, cands)
    assert score < 0.75


def test_style_percentiles_and_multiplier():
    assert percentile(15, [8, 10, 12, 15]) == 0.875
    s = TeamStyle(1, 19, ppda=15.0, deep=5, deep_allowed=8, xg=1.0, xga=1.4, low_block=0.9)
    assert s.bucket == "low_block" and s.tags()["high_press"] == 0.1
    t = PlayerTactics(1, split={"low_block": {"minutes": 900, "xgi90": 0.7, "shrunk": 0.65, "ratio": 1.18}})
    assert t.mult("low_block") == 1.18 and t.mult("high_press") == 1.0


def test_match_teams_with_simultaneous_kickoffs():
    # 4 tim, 3 "pekan", dua laga pada jam yang sama setiap pekan → suara terbagi, penugasan tetap benar.
    t0 = datetime(2026, 8, 22, 14, tzinfo=UTC)
    pairs = [((1, 2), (3, 4)), ((1, 3), (2, 4)), ((4, 1), (3, 2))]
    our = {1: 11, 2: 12, 3: 13, 4: 14}
    um, ours = [], []
    for w, games in enumerate(pairs):
        t = t0 + timedelta(days=7 * w)
        for k, (h, a) in enumerate(games):
            um.append(UMatch(100 * w + k, h, a, "", "", t, True, 0, 0, 0.0, 0.0))
            ours.append((our[h], our[a], t))
    assert match_teams(um, ours) == our
