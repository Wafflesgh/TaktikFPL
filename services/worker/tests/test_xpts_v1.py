"""xPts v1: komponen mengikuti kekuatan laga dan aturan poin dari data."""

from app.jobs.evaluate_model import metrics, spearman
from app.jobs.sync_bootstrap import scoring_rules
from app.models.xpts_v1 import MatchRates, PlayerRates, p_sixty, project_v1

RULES = {
    "short_play": 1,
    "long_play": 2,
    "assists": 3,
    "saves": 1,
    "bonus": 1,
    "yellow_cards": -1,
    "goals_scored_FWD": 4,
    "goals_scored_MID": 5,
    "goals_scored_DEF": 6,
    "goals_scored_GKP": 10,
    "clean_sheets_DEF": 4,
    "clean_sheets_GKP": 4,
    "clean_sheets_MID": 1,
    "clean_sheets_FWD": 0,
    "goals_conceded_DEF": -1,
    "goals_conceded_GKP": -1,
    "goals_conceded_MID": 0,
    "goals_conceded_FWD": 0,
    "defensive_contribution_DEF": 2,
    "defensive_contribution_MID": 2,
    "defensive_contribution_FWD": 2,
}
STRIKER = PlayerRates("FWD", 85, 1.0, 0.6, 0.15, 0.3, 0.0, 0.1, 0.05)
DEFENDER = PlayerRates("DEF", 90, 1.0, 0.05, 0.05, 0.2, 0.0, 0.1, 0.4)


def m(att=1.0, dfn=1.0, opp_att=1.0, opp_def=1.0, home=True):
    return MatchRates(att, dfn, opp_att, opp_def, home, 1.35)


def test_weak_opponent_raises_attacker_and_defender():
    easy = m(opp_att=0.7, opp_def=1.3)
    hard = m(opp_att=1.3, opp_def=0.7)
    assert project_v1(STRIKER, easy, RULES)["xpts"] > project_v1(STRIKER, hard, RULES)["xpts"]
    e, h = project_v1(DEFENDER, easy, RULES), project_v1(DEFENDER, hard, RULES)
    assert e["p_cs"] > h["p_cs"] and e["xpts"] > h["xpts"]


def test_unavailable_player_scores_zero_and_rules_drive_points():
    out = project_v1(PlayerRates("MID", 90, 0.0, 0.5, 0.3, 0.3, 0.0, 0.1, 0.2), m(), RULES)
    assert out["xpts"] == 0
    mid_cs = project_v1(PlayerRates("MID", 90, 1.0, 0, 0, 0, 0, 0, 0), m(), RULES)["c_clean_sheet"]
    def_cs = project_v1(PlayerRates("DEF", 90, 1.0, 0, 0, 0, 0, 0, 0), m(), RULES)["c_clean_sheet"]
    assert abs(def_cs - 4 * mid_cs) < 1e-3  # CS DEF 4 poin vs MID 1 poin dari aturan


def test_p_sixty_curve():
    assert p_sixty(0) == 0 and p_sixty(90) == 1 and 0 < p_sixty(50) < 1


def test_scoring_rules_flatten_positions():
    rules = scoring_rules(
        {"game_config": {"scoring": {"assists": 3, "goals_scored": {"MID": 5}, "mng_win": {"MID": 6}}}}
    )
    assert rules == {"assists": 3.0, "goals_scored_MID": 5.0}


def test_metrics_and_spearman():
    assert round(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 6) == 1.0
    res = metrics([2.0, 4.0, 6.0], [2.0, 4.0, 9.0])
    assert res["mae_xpts"] == 1.0 and res["bias_xpts"] == -1.0
