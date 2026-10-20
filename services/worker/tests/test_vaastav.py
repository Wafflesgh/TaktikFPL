"""Parser dataset historis (vaastav): rekonstruksi fixture, GW COVID, manajer, tim tanpa teams.csv."""

from datetime import UTC, datetime, timedelta

from app.sources import vaastav as v

PLAYERS_RAW = """id,code,first_name,second_name,web_name,element_type,team,team_code
1,1001,Petr,Cech,Cech,1,1,3
2,1002,Eden,Hazard,Hazard,3,2,8
3,1003,Pep,Guardiola,Guardiola,5,3,43
"""

# ruff: noqa: E501 — baris CSV contoh sengaja utuh agar mudah dibaca
MERGED = """name,element,fixture,round,kickoff_time,minutes,total_points,was_home,opponent_team,team_h_score,team_a_score,value,recoveries,xP
Cech,1,10,1,2016-08-14T15:00:00Z,90,6,True,2,1,0,50,4,3.5
Hazard,2,10,1,2016-08-14T15:00:00Z,90,2,False,1,1,0,100,7,5.1
Hazard,2,11,39,2020-06-20T15:00:00Z,90,8,True,1,2,0,100,2,4.0
"""

MASTER = """season,team,team_name
2016-17,1,Arsenal
2016-17,2,Chelsea
2016-17,3,Man City
"""


def test_season_helpers():
    assert v.season_label("2016-17") == "2016/17"
    assert v.season_folder("2026/27") == "2026-27"
    folders = v.past_season_folders("2026/27")
    assert folders[0] == "2025-26" and folders[-1] == "2016-17" and len(folders) == 10


def test_covid_gameweeks_remapped_only_for_2019_20():
    assert v.gw_number("2019-20", 39) == 30
    assert v.gw_number("2019-20", 47) == 38
    assert v.gw_number("2019-20", 29) == 29
    assert v.gw_number("2020-21", 38) == 38


def test_players_skip_managers():
    players = v.parse_players(v.read_csv(PLAYERS_RAW))
    assert [p.web_name for p in players] == ["Cech", "Hazard"]
    assert players[0].position == "GKP" and players[1].position == "MID"


def test_teams_without_teams_csv_use_master_list_and_codes():
    teams = v.parse_teams("2016-17", None, MASTER, v.read_csv(PLAYERS_RAW))
    by_id = {t.fpl_team_id: t for t in teams}
    assert by_id[1].name == "Arsenal" and by_id[1].code == 3
    assert by_id[2].name == "Chelsea" and by_id[2].code == 8


def test_gw_rows_core_and_extra_columns():
    rows = v.parse_gw_rows("2016-17", v.read_csv(MERGED))
    assert len(rows) == 3
    cech = rows[0]
    assert cech.values["total_points"] == 6 and cech.values["fpl_xp"] == 3.5
    assert cech.was_home is True and cech.opponent_fpl_team == 2
    assert cech.extra == {"recoveries": 4.0}  # statistik khusus musim disimpan di extra


def test_reconstruct_fixture_home_away_from_opponents():
    rows = v.parse_gw_rows("2016-17", v.read_csv(MERGED))
    player_team = {1: 1, 2: 2}
    fixtures = {f.fpl_fixture_id: f for f in v.reconstruct_fixtures(rows, player_team)}
    f10 = fixtures[10]
    assert (f10.fpl_team_h, f10.fpl_team_a) == (1, 2)
    assert (f10.home_goals, f10.away_goals) == (1, 0)
    assert f10.kickoff_utc == datetime(2016, 8, 14, 15, 0, tzinfo=UTC)


def test_deadline_estimated_before_first_kickoff():
    rows = v.parse_gw_rows("2016-17", v.read_csv(MERGED))
    fixtures = v.reconstruct_fixtures(rows, {1: 1, 2: 2})
    deadlines = v.estimate_deadlines(fixtures)
    assert deadlines[1] == datetime(2016, 8, 14, 15, 0, tzinfo=UTC) - timedelta(minutes=90)


def test_value_parsers():
    assert v.to_int("3.0") == 3 and v.to_int("") is None and v.to_int("abc") is None
    assert v.to_float("0.25") == 0.25 and v.to_float("nan") is None
    assert v.to_bool("True") is True and v.to_bool("False") is False and v.to_bool("") is None
