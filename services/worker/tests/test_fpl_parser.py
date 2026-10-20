"""Contract test parser FPL terhadap sampel JSON nyata (musim 2026/27)."""

from datetime import UTC, datetime

import httpx
import pytest
import respx

from app.sources.base import SourceHTTPError
from app.sources.fpl import (
    FPLClient,
    fixture_status,
    parse_event_status,
    parse_events,
    parse_fixtures,
    parse_players,
    parse_teams,
    position_map,
)


def test_bootstrap_contract_keys(bootstrap):
    for key in ("events", "teams", "elements", "element_types", "chips", "game_settings"):
        assert key in bootstrap, f"field '{key}' hilang dari bootstrap-static"
    element = bootstrap["elements"][0]
    for key in (
        "id",
        "code",
        "web_name",
        "team",
        "element_type",
        "now_cost",
        "status",
        "chance_of_playing_next_round",
        "news",
        "news_added",
        "photo",
        "selected_by_percent",
    ):
        assert key in element, f"field elements[].{key} hilang"


def test_position_map_from_payload(bootstrap):
    assert position_map(bootstrap) == {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def test_parse_teams(bootstrap):
    teams = parse_teams(bootstrap)
    assert len(teams) == 20
    assert len({t.code for t in teams}) == 20
    assert all(1 <= t.fpl_team_id <= 20 for t in teams)
    names = {t.name for t in teams}
    assert {"Coventry City", "Hull City", "Ipswich Town"} <= names  # klub promosi 2026/27


def test_parse_players(bootstrap):
    players = parse_players(bootstrap)
    assert len(players) == len(bootstrap["elements"])
    assert {p.position for p in players} == {"GKP", "DEF", "MID", "FWD"}
    first = players[0]
    assert first.full_name and first.web_name
    assert isinstance(first.price_tenths, int) and first.price_tenths > 30
    assert first.selected_by_pct is None or 0 <= first.selected_by_pct <= 100
    # status non-'a' terbawa, berita kosong dinormalisasi ke None
    assert any(p.status != "a" for p in players)
    assert all(p.news is None or p.news.strip() for p in players)


def test_parse_events(bootstrap):
    events = parse_events(bootstrap)
    assert len(events) == 38
    assert [e.number for e in events] == list(range(1, 39))
    assert all(e.deadline_utc.tzinfo is not None for e in events)
    assert sum(e.is_next for e in events) <= 1
    assert sum(e.is_current for e in events) <= 1


def test_parse_fixtures(fixtures_payload):
    rows = parse_fixtures(fixtures_payload)
    assert len(rows) == len(fixtures_payload)
    first = rows[0]
    assert first.kickoff_utc == datetime(2026, 8, 21, 19, 0, tzinfo=UTC)
    assert first.status == "finished"
    assert first.home_goals is not None


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"finished": True, "event": 1, "kickoff_time": "x"}, "finished"),
        ({"finished_provisional": True, "event": 1, "kickoff_time": "x"}, "finished"),
        ({"started": True, "event": 1, "kickoff_time": "x"}, "live"),
        ({"event": None, "kickoff_time": None}, "postponed"),
        ({"event": 9, "kickoff_time": None}, "tbc"),
        ({"event": 9, "kickoff_time": "2026-10-25T14:00:00Z"}, "scheduled"),
    ],
)
def test_fixture_status(payload, expected):
    assert fixture_status(payload) == expected


def test_parse_event_status(event_status):
    parsed = parse_event_status(event_status)
    assert parsed[7] == {"bonus_confirmed": True, "leagues_updated": True}
    partial = parse_event_status(
        {"status": [{"event": 8, "bonus_added": True}, {"event": 8, "bonus_added": False}], "leagues": ""}
    )
    assert partial[8] == {"bonus_confirmed": False, "leagues_updated": False}


@respx.mock
def test_client_retries_on_503_then_succeeds(monkeypatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _s: None)
    route = respx.get("https://fpl.test/api/event-status/").mock(
        side_effect=[
            httpx.Response(503, text="The game is being updated."),
            httpx.Response(200, json={"status": []}),
        ]
    )
    with FPLClient(base_url="https://fpl.test/api/", rps=0) as client:
        assert client.event_status() == {"status": []}
    assert route.call_count == 2
    assert route.calls[0].request.headers["User-Agent"].startswith("TaktikFPL/")


@respx.mock
def test_client_does_not_retry_404(monkeypatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _s: None)
    route = respx.get("https://fpl.test/api/entry/1/").mock(return_value=httpx.Response(404, json={}))
    with FPLClient(base_url="https://fpl.test/api/", rps=0) as client, pytest.raises(SourceHTTPError):
        client.entry(1)
    assert route.call_count == 1
