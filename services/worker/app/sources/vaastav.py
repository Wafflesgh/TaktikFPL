"""Dataset historis FPL komunitas: github.com/vaastav/Fantasy-Premier-League (2016/17–sekarang).

Dipakai sebagai data pendukung analisis & training ML untuk musim yang sudah tidak tersedia di
API FPL. Lisensi repo tidak dinyatakan (NOASSERTION) → hanya untuk pemakaian pribadi, file asli
diarsip permanen (sumber 'vaastav') agar asal-usul data bisa dilacak.

Kekhasan dataset yang ditangani di sini:
- 2016/17–2017/18 tanpa fixtures.csv → fixture direkonstruksi dari merged_gw (lawan + kandang).
- s.d. 2018/19 tanpa teams.csv → nama dari master_team_list.csv, kode tim dari players_raw.
- 2019/20: GW 39–47 = GW30–38 setelah jeda COVID → dipetakan −9.
- 2024/25+: element_type 5 = manajer (chip Assistant Manager) → dilewati.
"""

import csv
import io
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.sources.fpl import parse_dt

BASE_URL = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/"

# element_type stabil sejak awal FPL; musim lama tidak menyertakan daftar element_types.
POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

# Deadline GW tidak ada di dataset → diestimasi dari kick-off pertama GW.
DEADLINE_BEFORE_FIRST_KICKOFF = timedelta(minutes=90)

# Kolom merged_gw yang dipetakan ke kolom tabel; sisanya (angka) masuk `extra`.
CORE_COLUMNS = {
    "name",
    "position",
    "team",
    "element",
    "fixture",
    "round",
    "GW",
    "kickoff_time",
    "kickoff_time_formatted",
    "minutes",
    "total_points",
    "bonus",
    "bps",
    "goals_scored",
    "assists",
    "clean_sheets",
    "goals_conceded",
    "own_goals",
    "penalties_saved",
    "penalties_missed",
    "yellow_cards",
    "red_cards",
    "saves",
    "defensive_contribution",
    "expected_goals",
    "expected_assists",
    "expected_goal_involvements",
    "expected_goals_conceded",
    "influence",
    "creativity",
    "threat",
    "ict_index",
    "value",
    "selected",
    "xP",
    "starts",
    "was_home",
    "opponent_team",
    "transfers_in",
    "transfers_out",
    "transfers_balance",
    "team_h_score",
    "team_a_score",
    "id",
    "modified",
}


def season_folder(label: str) -> str:
    """'2016/17' → '2016-17'"""
    return label.replace("/", "-")


def season_label(folder: str) -> str:
    """'2016-17' → '2016/17'"""
    return folder.replace("-", "/")


def past_season_folders(current_label: str, first: str = "2016-17") -> list[str]:
    """Semua musim dari `first` sampai sebelum musim berjalan, terbaru dulu."""
    start = int(first[:4])
    end = int(current_label[:4])
    return [f"{y}-{str(y + 1)[-2:]}" for y in range(end - 1, start - 1, -1)]


def gw_number(folder: str, raw_round: int) -> int:
    if folder == "2019-20" and raw_round > 38:
        return raw_round - 9
    return raw_round


def read_csv(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))


def to_int(v: Any) -> int | None:
    if v in (None, "", "None", "nan"):
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def to_float(v: Any) -> float | None:
    if v in (None, "", "None", "nan"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_bool(v: Any) -> bool | None:
    if v in (None, ""):
        return None
    return str(v).strip().lower() in ("true", "1")


@dataclass
class SeasonTeam:
    fpl_team_id: int
    code: int
    name: str
    short_name: str | None


@dataclass
class SeasonPlayer:
    fpl_element_id: int
    code: int
    full_name: str
    web_name: str
    position: str
    fpl_team_id: int


@dataclass
class SeasonFixture:
    fpl_fixture_id: int
    gw: int | None
    kickoff_utc: datetime | None
    fpl_team_h: int
    fpl_team_a: int
    home_goals: int | None
    away_goals: int | None
    difficulty_home: int | None = None
    difficulty_away: int | None = None


@dataclass
class SeasonGwRow:
    fpl_element_id: int
    fpl_fixture_id: int
    gw: int
    was_home: bool | None
    opponent_fpl_team: int | None
    values: dict[str, Any]
    extra: dict[str, float] = field(default_factory=dict)


def parse_teams(
    folder: str, teams_csv: str | None, master_csv: str, players: list[dict[str, str]]
) -> list[SeasonTeam]:
    if teams_csv:
        return [
            SeasonTeam(int(r["id"]), int(r["code"]), r["name"], r.get("short_name") or None)
            for r in read_csv(teams_csv)
        ]
    # Tanpa teams.csv: nama dari master_team_list, kode dari players_raw (team → team_code).
    names = {int(r["team"]): r["team_name"] for r in read_csv(master_csv) if r["season"] == folder}
    codes: dict[int, Counter[int]] = defaultdict(Counter)
    for p in players:
        if p.get("team_code"):
            codes[int(p["team"])][int(p["team_code"])] += 1
    return [
        SeasonTeam(tid, codes[tid].most_common(1)[0][0], names.get(tid, f"Team {tid}"), None)
        for tid in sorted(codes)
    ]


def parse_players(players_raw: list[dict[str, str]]) -> list[SeasonPlayer]:
    out = []
    for r in players_raw:
        et = to_int(r.get("element_type"))
        if et not in POSITIONS:  # 5 = manajer (2024/25+)
            continue
        full = f"{r.get('first_name', '')} {r.get('second_name', '')}".strip()
        out.append(
            SeasonPlayer(
                fpl_element_id=int(r["id"]),
                code=int(r["code"]),
                full_name=full or r["web_name"],
                web_name=r["web_name"],
                position=POSITIONS[et],
                fpl_team_id=int(r["team"]),
            )
        )
    return out


def parse_gw_rows(folder: str, merged: list[dict[str, str]]) -> list[SeasonGwRow]:
    rows = []
    for r in merged:
        raw_round = to_int(r.get("round")) or to_int(r.get("GW"))
        element, fixture = to_int(r.get("element")), to_int(r.get("fixture"))
        if raw_round is None or element is None or fixture is None:
            continue
        values = {
            "minutes": to_int(r.get("minutes")),
            "total_points": to_int(r.get("total_points")),
            "bonus": to_int(r.get("bonus")),
            "bps": to_int(r.get("bps")),
            "goals_scored": to_int(r.get("goals_scored")),
            "assists": to_int(r.get("assists")),
            "clean_sheets": to_int(r.get("clean_sheets")),
            "goals_conceded": to_int(r.get("goals_conceded")),
            "own_goals": to_int(r.get("own_goals")),
            "penalties_saved": to_int(r.get("penalties_saved")),
            "penalties_missed": to_int(r.get("penalties_missed")),
            "yellow_cards": to_int(r.get("yellow_cards")),
            "red_cards": to_int(r.get("red_cards")),
            "saves": to_int(r.get("saves")),
            "defensive_contribution": to_int(r.get("defensive_contribution")),
            "expected_goals": to_float(r.get("expected_goals")),
            "expected_assists": to_float(r.get("expected_assists")),
            "expected_goal_involvements": to_float(r.get("expected_goal_involvements")),
            "expected_goals_conceded": to_float(r.get("expected_goals_conceded")),
            "influence": to_float(r.get("influence")),
            "creativity": to_float(r.get("creativity")),
            "threat": to_float(r.get("threat")),
            "ict_index": to_float(r.get("ict_index")),
            "value_tenths": to_int(r.get("value")),
            "selected": to_int(r.get("selected")),
            "fpl_xp": to_float(r.get("xP")),
            "starts": to_int(r.get("starts")),
            "transfers_in": to_int(r.get("transfers_in")),
            "transfers_out": to_int(r.get("transfers_out")),
            "transfers_balance": to_int(r.get("transfers_balance")),
            "kickoff_utc": parse_dt(r.get("kickoff_time") or None),
            "team_h_score": to_int(r.get("team_h_score")),
            "team_a_score": to_int(r.get("team_a_score")),
        }
        extra = {k: f for k, v in r.items() if k not in CORE_COLUMNS and (f := to_float(v)) is not None}
        rows.append(
            SeasonGwRow(
                fpl_element_id=element,
                fpl_fixture_id=fixture,
                gw=gw_number(folder, raw_round),
                was_home=to_bool(r.get("was_home")),
                opponent_fpl_team=to_int(r.get("opponent_team")),
                values=values,
                extra=extra,
            )
        )
    return rows


def parse_fixtures(folder: str, fixtures_csv: str) -> list[SeasonFixture]:
    out = []
    for r in read_csv(fixtures_csv):
        event = to_int(r.get("event"))
        out.append(
            SeasonFixture(
                fpl_fixture_id=int(r["id"]),
                gw=gw_number(folder, event) if event is not None else None,
                kickoff_utc=parse_dt(r.get("kickoff_time") or None),
                fpl_team_h=int(r["team_h"]),
                fpl_team_a=int(r["team_a"]),
                home_goals=to_int(r.get("team_h_score")),
                away_goals=to_int(r.get("team_a_score")),
                difficulty_home=to_int(r.get("team_h_difficulty")),
                difficulty_away=to_int(r.get("team_a_difficulty")),
            )
        )
    return out


def reconstruct_fixtures(rows: list[SeasonGwRow], player_team: dict[int, int]) -> list[SeasonFixture]:
    """Bangun fixture dari baris per pemain: lawan + kandang/tandang menentukan tim tuan rumah/tamu."""
    info: dict[int, dict[str, Any]] = {}
    home_votes: dict[int, Counter[int]] = defaultdict(Counter)
    away_votes: dict[int, Counter[int]] = defaultdict(Counter)
    for r in rows:
        f = info.setdefault(
            r.fpl_fixture_id,
            {
                "gw": r.gw,
                "kickoff": r.values["kickoff_utc"],
                "hg": r.values["team_h_score"],
                "ag": r.values["team_a_score"],
            },
        )
        if f["kickoff"] is None:
            f["kickoff"] = r.values["kickoff_utc"]
        own = player_team.get(r.fpl_element_id)
        if r.was_home is True:
            if r.opponent_fpl_team:
                away_votes[r.fpl_fixture_id][r.opponent_fpl_team] += 1
            if own:
                home_votes[r.fpl_fixture_id][own] += 1
        elif r.was_home is False:
            if r.opponent_fpl_team:
                home_votes[r.fpl_fixture_id][r.opponent_fpl_team] += 1
            if own:
                away_votes[r.fpl_fixture_id][own] += 1
    out = []
    for fid, f in sorted(info.items()):
        if not home_votes[fid] or not away_votes[fid]:
            continue
        # Suara lawan (opponent_team) selalu akurat; tim pemain (akhir musim) hanya cadangan.
        out.append(
            SeasonFixture(
                fpl_fixture_id=fid,
                gw=f["gw"],
                kickoff_utc=f["kickoff"],
                fpl_team_h=home_votes[fid].most_common(1)[0][0],
                fpl_team_a=away_votes[fid].most_common(1)[0][0],
                home_goals=f["hg"],
                away_goals=f["ag"],
            )
        )
    return out


def estimate_deadlines(fixtures: list[SeasonFixture]) -> dict[int, datetime]:
    first: dict[int, datetime] = {}
    for f in fixtures:
        if f.gw is None or f.kickoff_utc is None:
            continue
        if f.gw not in first or f.kickoff_utc < first[f.gw]:
            first[f.gw] = f.kickoff_utc
    return {gw: ko - DEADLINE_BEFORE_FIRST_KICKOFF for gw, ko in first.items()}
