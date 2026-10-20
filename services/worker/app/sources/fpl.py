"""Adapter FPL API (publik, tanpa login).

API FPL tidak terdokumentasi resmi; parsing dilindungi contract test di
tests/fixtures/fpl/. Endpoint ber-cookie (my-team, me) sengaja tidak diimplementasikan di sini.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy.engine import Engine

from app.sources.base import SourceClient

USER_AGENT = "TaktikFPL/0.1 (personal use)"


class FPLClient(SourceClient):
    def __init__(
        self,
        base_url: str = "https://fantasy.premierleague.com/api/",
        rps: float = 1.0,
        engine: Engine | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        super().__init__(
            name="fpl",
            base_url=base_url,
            rps=rps,
            engine=engine,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            transport=transport,
        )

    def bootstrap_static(self) -> dict[str, Any]:
        return self.get_json("bootstrap-static/")

    def fixtures(self, event: int | None = None) -> list[dict[str, Any]]:
        return self.get_json("fixtures/", params={"event": event} if event is not None else None)

    def element_summary(self, element_id: int, store_raw: bool = True) -> dict[str, Any]:
        return self.get_json(f"element-summary/{element_id}/", store_raw=store_raw)

    def event_live(self, gw: int) -> dict[str, Any]:
        return self.get_json(f"event/{gw}/live/")

    def event_status(self) -> dict[str, Any]:
        return self.get_json("event-status/")

    def dream_team(self, gw: int) -> dict[str, Any]:
        return self.get_json(f"dream-team/{gw}/")

    def set_piece_notes(self) -> dict[str, Any]:
        return self.get_json("team/set-piece-notes/")

    def entry(self, entry_id: int) -> dict[str, Any]:
        return self.get_json(f"entry/{entry_id}/")

    def entry_history(self, entry_id: int) -> dict[str, Any]:
        return self.get_json(f"entry/{entry_id}/history/")

    def entry_transfers(self, entry_id: int) -> list[dict[str, Any]]:
        return self.get_json(f"entry/{entry_id}/transfers/")

    def entry_picks(self, entry_id: int, gw: int) -> dict[str, Any]:
        return self.get_json(f"entry/{entry_id}/event/{gw}/picks/")

    def league_classic(self, league_id: int, page: int = 1) -> dict[str, Any]:
        return self.get_json(f"leagues-classic/{league_id}/standings/", params={"page_standings": page})


# --------------------------------------------------------------------------- parsing
# Fungsi murni (tanpa I/O) supaya bisa diuji dengan fixture JSON.


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class TeamRow:
    fpl_team_id: int
    code: int
    name: str
    short_name: str


@dataclass(frozen=True)
class PlayerRow:
    fpl_element_id: int
    code: int
    full_name: str
    web_name: str
    photo_file: str | None
    fpl_team_id: int
    position: str
    status: str | None
    chance_next: int | None
    chance_this: int | None
    news: str | None
    news_added: datetime | None
    price_tenths: int
    selected_by_pct: float | None
    transfers_in_event: int | None
    transfers_out_event: int | None

    def status_key(self) -> tuple[Any, ...]:
        return (self.status, self.chance_next, self.chance_this, self.news or None, self.news_added)


@dataclass(frozen=True)
class EventRow:
    number: int
    deadline_utc: datetime
    is_current: bool
    is_next: bool
    is_finished: bool


@dataclass(frozen=True)
class FixtureRow:
    fpl_fixture_id: int
    event: int | None
    kickoff_utc: datetime | None
    fpl_team_h: int
    fpl_team_a: int
    status: str
    minute: int | None
    home_goals: int | None
    away_goals: int | None
    difficulty_home: int | None
    difficulty_away: int | None


def position_map(bootstrap: dict[str, Any]) -> dict[int, str]:
    """element_type id → GKP/DEF/MID/FWD dibaca dari payload, bukan hardcode."""
    return {et["id"]: et["singular_name_short"] for et in bootstrap["element_types"]}


def parse_teams(bootstrap: dict[str, Any]) -> list[TeamRow]:
    return [
        TeamRow(fpl_team_id=t["id"], code=t["code"], name=t["name"], short_name=t["short_name"])
        for t in bootstrap["teams"]
    ]


def _pct(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def parse_players(bootstrap: dict[str, Any]) -> list[PlayerRow]:
    positions = position_map(bootstrap)
    rows = []
    for e in bootstrap["elements"]:
        full = f"{e.get('first_name', '')} {e.get('second_name', '')}".strip() or e["web_name"]
        rows.append(
            PlayerRow(
                fpl_element_id=e["id"],
                code=e["code"],
                full_name=full,
                web_name=e["web_name"],
                photo_file=e.get("photo") or None,
                fpl_team_id=e["team"],
                position=positions[e["element_type"]],
                status=e.get("status"),
                chance_next=e.get("chance_of_playing_next_round"),
                chance_this=e.get("chance_of_playing_this_round"),
                news=e.get("news") or None,
                news_added=parse_dt(e.get("news_added")),
                price_tenths=e["now_cost"],
                selected_by_pct=_pct(e.get("selected_by_percent")),
                transfers_in_event=e.get("transfers_in_event"),
                transfers_out_event=e.get("transfers_out_event"),
            )
        )
    return rows


def parse_events(bootstrap: dict[str, Any]) -> list[EventRow]:
    rows = []
    for ev in bootstrap["events"]:
        deadline = parse_dt(ev["deadline_time"])
        if deadline is None:
            continue
        rows.append(
            EventRow(
                number=ev["id"],
                deadline_utc=deadline,
                is_current=bool(ev.get("is_current")),
                is_next=bool(ev.get("is_next")),
                is_finished=bool(ev.get("finished")),
            )
        )
    return rows


def fixture_status(f: dict[str, Any]) -> str:
    if f.get("finished") or f.get("finished_provisional"):
        return "finished"
    if f.get("started"):
        return "live"
    if f.get("event") is None:
        return "postponed"  # dikeluarkan dari GW mana pun (blank) sampai dijadwalkan ulang
    if not f.get("kickoff_time"):
        return "tbc"
    return "scheduled"


def parse_fixtures(fixtures: list[dict[str, Any]]) -> list[FixtureRow]:
    return [
        FixtureRow(
            fpl_fixture_id=f["id"],
            event=f.get("event"),
            kickoff_utc=parse_dt(f.get("kickoff_time")),
            fpl_team_h=f["team_h"],
            fpl_team_a=f["team_a"],
            status=fixture_status(f),
            minute=f.get("minutes"),
            home_goals=f.get("team_h_score"),
            away_goals=f.get("team_a_score"),
            difficulty_home=f.get("team_h_difficulty"),
            difficulty_away=f.get("team_a_difficulty"),
        )
        for f in fixtures
    ]


def parse_event_status(payload: dict[str, Any]) -> dict[int, dict[str, bool]]:
    """event-status/ → {gw: {bonus_confirmed, leagues_updated}}."""
    leagues_updated = payload.get("leagues") == "Updated"
    by_event: dict[int, list[bool]] = {}
    for s in payload.get("status", []):
        by_event.setdefault(s["event"], []).append(bool(s.get("bonus_added")))
    return {
        gw: {"bonus_confirmed": all(flags), "leagues_updated": leagues_updated}
        for gw, flags in by_event.items()
    }


def _f(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


@dataclass(frozen=True)
class HistoryRow:
    """Satu baris element-summary.history (satu laga pemain, termasuk laga DGW)."""

    fpl_fixture_id: int
    round: int
    kickoff_utc: datetime | None
    minutes: int
    total_points: int
    bonus: int
    bps: int
    goals_scored: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    own_goals: int
    penalties_saved: int
    penalties_missed: int
    yellow_cards: int
    red_cards: int
    saves: int
    defensive_contribution: int | None
    expected_goals: float | None
    expected_assists: float | None
    expected_goal_involvements: float | None
    expected_goals_conceded: float | None
    influence: float | None
    creativity: float | None
    threat: float | None
    ict_index: float | None
    value_tenths: int | None
    selected: int | None


def parse_history(summary: dict[str, Any]) -> list[HistoryRow]:
    rows = []
    for h in summary.get("history", []):
        rows.append(
            HistoryRow(
                fpl_fixture_id=h["fixture"],
                round=h["round"],
                kickoff_utc=parse_dt(h.get("kickoff_time")),
                minutes=h.get("minutes", 0),
                total_points=h.get("total_points", 0),
                bonus=h.get("bonus", 0),
                bps=h.get("bps", 0),
                goals_scored=h.get("goals_scored", 0),
                assists=h.get("assists", 0),
                clean_sheets=h.get("clean_sheets", 0),
                goals_conceded=h.get("goals_conceded", 0),
                own_goals=h.get("own_goals", 0),
                penalties_saved=h.get("penalties_saved", 0),
                penalties_missed=h.get("penalties_missed", 0),
                yellow_cards=h.get("yellow_cards", 0),
                red_cards=h.get("red_cards", 0),
                saves=h.get("saves", 0),
                defensive_contribution=h.get("defensive_contribution"),
                expected_goals=_f(h.get("expected_goals")),
                expected_assists=_f(h.get("expected_assists")),
                expected_goal_involvements=_f(h.get("expected_goal_involvements")),
                expected_goals_conceded=_f(h.get("expected_goals_conceded")),
                influence=_f(h.get("influence")),
                creativity=_f(h.get("creativity")),
                threat=_f(h.get("threat")),
                ict_index=_f(h.get("ict_index")),
                value_tenths=h.get("value"),
                selected=h.get("selected"),
            )
        )
    return rows
