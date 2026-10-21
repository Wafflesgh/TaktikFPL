"""Adapter Understat (gratis, tanpa API resmi — endpoint JSON yang dipakai situsnya sendiri).

Dipakai untuk data taktik Premier League: PPDA & deep completions per tim per laga, posisi tiap pemain
per laga (peran), dan tembakan (xG per situasi). Sopan: 1 request / 2 detik, retry dari SourceClient.

Kebijakan arsip (CLAUDE.md aturan 9): getLeagueData diarsip harian (isi berubah tiap laga);
getMatchData diarsip sekali per laga selesai (immutable). raw_payloads tidak dipakai untuk data
per laga agar DB free tier tidak membengkak.

Season Understat = tahun mulai musim: 2026 → 2026/27.
"""

import html
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from difflib import SequenceMatcher
from typing import Any

import httpx
from sqlalchemy.engine import Engine

from app.sources.base import SourceClient

USER_AGENT = "TaktikFPL/0.1 (personal use)"


class UnderstatClient(SourceClient):
    def __init__(
        self,
        base_url: str = "https://understat.com/",
        rps: float = 0.5,
        engine: Engine | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        super().__init__(
            name="understat",
            base_url=base_url,
            rps=rps,
            engine=engine,
            headers={
                "User-Agent": USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json",
            },
            transport=transport,
        )

    def league_data(self, season_year: int, league: str = "EPL") -> dict[str, Any]:
        return self.get_json(f"getLeagueData/{league}/{season_year}", store_raw=False)

    def match_data(self, match_id: int) -> dict[str, Any]:
        return self.get_json(f"getMatchData/{match_id}", store_raw=False)


def season_year(label: str) -> int:
    """'2026/27' → 2026."""
    return int(label[:4])


# --------------------------------------------------------------------------- parsing (murni)


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _i(v: Any) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _dt(v: str) -> datetime:
    # Understat memakai UTC tanpa zona ("2026-08-21 19:00:00").
    return datetime.fromisoformat(v).replace(tzinfo=UTC)


@dataclass(frozen=True)
class UMatch:
    id: int
    home_id: int
    away_id: int
    home_title: str
    away_title: str
    kickoff_utc: datetime
    is_result: bool
    home_goals: int | None
    away_goals: int | None
    home_xg: float | None
    away_xg: float | None


def parse_matches(league: dict[str, Any]) -> list[UMatch]:
    out = []
    for m in league.get("dates") or []:
        res = bool(m.get("isResult"))
        out.append(
            UMatch(
                id=_i(m["id"]),
                home_id=_i(m["h"]["id"]),
                away_id=_i(m["a"]["id"]),
                home_title=m["h"]["title"],
                away_title=m["a"]["title"],
                kickoff_utc=_dt(m["datetime"]),
                is_result=res,
                home_goals=_i(m["goals"]["h"]) if res else None,
                away_goals=_i(m["goals"]["a"]) if res else None,
                home_xg=_f(m["xG"]["h"]) if res else None,
                away_xg=_f(m["xG"]["a"]) if res else None,
            )
        )
    return out


@dataclass(frozen=True)
class UTeamMatch:
    team_id: int
    title: str
    kickoff_utc: datetime
    is_home: bool
    xg: float
    xga: float
    npxg: float
    npxga: float
    ppda: float | None  # umpan lawan per aksi bertahan tim ini (tinggi = pasif / blok rendah)
    ppda_allowed: float | None  # PPDA lawan saat tim ini menguasai bola
    deep: int  # umpan selesai ≤20 m dari gawang lawan
    deep_allowed: int
    scored: int
    missed: int


def _ratio(d: dict[str, Any] | None) -> float | None:
    if not d:
        return None
    att, dfn = _f(d.get("att")), _f(d.get("def"))
    return round(att / dfn, 3) if dfn else None


def parse_team_history(league: dict[str, Any]) -> list[UTeamMatch]:
    out = []
    for t in (league.get("teams") or {}).values():
        for h in t.get("history") or []:
            out.append(
                UTeamMatch(
                    team_id=_i(t["id"]),
                    title=t["title"],
                    kickoff_utc=_dt(h["date"]),
                    is_home=h.get("h_a") == "h",
                    xg=_f(h.get("xG")),
                    xga=_f(h.get("xGA")),
                    npxg=_f(h.get("npxG")),
                    npxga=_f(h.get("npxGA")),
                    ppda=_ratio(h.get("ppda")),
                    ppda_allowed=_ratio(h.get("ppda_allowed")),
                    deep=_i(h.get("deep")),
                    deep_allowed=_i(h.get("deep_allowed")),
                    scored=_i(h.get("scored")),
                    missed=_i(h.get("missed")),
                )
            )
    return out


@dataclass(frozen=True)
class URoster:
    match_id: int
    player_id: int
    name: str
    team_id: int
    is_home: bool
    position: str  # GK, DR, DC, DL, DMC, MR, MC, ML, AMR, AMC, AML, FWR, FW, FWL, Sub
    position_order: int
    minutes: int
    goals: int
    own_goals: int
    shots: int
    xg: float
    xa: float
    assists: int
    key_passes: int
    xg_chain: float
    xg_buildup: float
    yellow: int
    red: int


@dataclass(frozen=True)
class UShot:
    id: int
    match_id: int
    player_id: int
    player: str
    is_home: bool
    minute: int
    x: float
    y: float
    xg: float
    result: str
    situation: str  # OpenPlay | FromCorner | SetPiece | DirectFreekick | Penalty
    shot_type: str
    last_action: str
    assisted_by: str | None


def parse_match(payload: dict[str, Any], match_id: int) -> tuple[list[URoster], list[UShot]]:
    rosters = []
    for side in ("h", "a"):
        for r in ((payload.get("rosters") or {}).get(side) or {}).values():
            rosters.append(
                URoster(
                    match_id=match_id,
                    player_id=_i(r["player_id"]),
                    name=html.unescape(r.get("player") or ""),
                    team_id=_i(r.get("team_id")),
                    is_home=side == "h",
                    position=r.get("position") or "",
                    position_order=_i(r.get("positionOrder")),
                    minutes=_i(r.get("time")),
                    goals=_i(r.get("goals")),
                    own_goals=_i(r.get("own_goals")),
                    shots=_i(r.get("shots")),
                    xg=_f(r.get("xG")),
                    xa=_f(r.get("xA")),
                    assists=_i(r.get("assists")),
                    key_passes=_i(r.get("key_passes")),
                    xg_chain=_f(r.get("xGChain")),
                    xg_buildup=_f(r.get("xGBuildup")),
                    yellow=_i(r.get("yellow_card")),
                    red=_i(r.get("red_card")),
                )
            )
    shots = []
    for side in ("h", "a"):
        for s in (payload.get("shots") or {}).get(side) or []:
            shots.append(
                UShot(
                    id=_i(s["id"]),
                    match_id=match_id,
                    player_id=_i(s.get("player_id")),
                    player=html.unescape(s.get("player") or ""),
                    is_home=side == "h",
                    minute=_i(s.get("minute")),
                    x=_f(s.get("X")),
                    y=_f(s.get("Y")),
                    xg=_f(s.get("xG")),
                    result=s.get("result") or "",
                    situation=s.get("situation") or "",
                    shot_type=s.get("shotType") or "",
                    last_action=s.get("lastAction") or "",
                    assisted_by=html.unescape(s.get("player_assisted") or "") or None,
                )
            )
    return rosters, shots


# --------------------------------------------------------------------------- pencocokan entitas
# Tanpa daftar nama klub/pemain hardcode (CLAUDE.md aturan 4): tim dicocokkan lewat jadwal
# (waktu kick-off + kandang/tandang), pemain lewat kemiripan nama + kecocokan menit per laga.


def normalize_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", html.unescape(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().replace("-", " ").replace("'", "").replace(".", " ").split())


def _tok_eq(a: str, b: str) -> bool:
    return a == b or (min(len(a), len(b)) >= 4 and SequenceMatcher(None, a, b).ratio() >= 0.83)


def name_similarity(a: str, b: str) -> float:
    """0..1: maksimum dari rasio urutan dan tumpang-tindih token (fuzzy, menangani nama tengah,
    urutan, dan ejaan berbeda seperti "Yeremi" vs "Yéremy")."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    seq = SequenceMatcher(None, na, nb).ratio()
    ta, tb = na.split(), nb.split()
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    overlap = sum(1 for t in short if any(_tok_eq(t, u) for u in long_)) / len(short)
    # Nama belakang dari nama yang lebih pendek muncul di nama panjang = sinyal kuat
    # (mis. "Gabriel Magalhães" vs "Gabriel dos Santos Magalhães", "Yeremi Pino" vs "Yéremy Pino Santos").
    last = 1.0 if any(_tok_eq(short[-1], u) for u in long_) else 0.0
    return max(seq, overlap if last else 0.6 * overlap, 0.7 * last + 0.3 * seq)


def match_teams(
    umatches: list[UMatch],
    fixtures: list[tuple[int, int, datetime]],  # (home_team_id, away_team_id, kickoff_utc)
    tolerance_h: float = 3.0,
) -> dict[int, int]:
    """Id tim Understat → id tim kita, lewat voting laga yang kick-off-nya sama (± toleransi)."""
    votes: dict[int, dict[int, int]] = {}
    by_day: dict[str, list[tuple[int, int, datetime]]] = {}
    for f in fixtures:
        by_day.setdefault(f[2].date().isoformat(), []).append(f)
    for m in umatches:
        for f in by_day.get(m.kickoff_utc.date().isoformat(), []):
            if abs((f[2] - m.kickoff_utc).total_seconds()) <= tolerance_h * 3600:
                votes.setdefault(m.home_id, {}).setdefault(f[0], 0)
                votes[m.home_id][f[0]] += 1
                votes.setdefault(m.away_id, {}).setdefault(f[1], 0)
                votes[m.away_id][f[1]] += 1
    # Penugasan satu-ke-satu, suara terbanyak dulu: pada slot kick-off yang sama banyak tim saling
    # "berbagi" suara, tetapi pasangan yang benar konsisten sepanjang musim.
    ranked = sorted(((n, uid, tid) for uid, cand in votes.items() for tid, n in cand.items()), reverse=True)
    out: dict[int, int] = {}
    used: set[int] = set()
    for n, uid, tid in ranked:
        if n < 2 or uid in out or tid in used:
            continue
        out[uid] = tid
        used.add(tid)
    return out


def match_fixture(
    m: UMatch,
    team_map: dict[int, int],
    fixtures: list[tuple[int, int, int, datetime | None]],
    max_days: float = 4.0,
) -> int | None:
    """Laga Understat → id fixture kita (tim kandang & tandang sama, kick-off terdekat ≤ max_days)."""
    h, a = team_map.get(m.home_id), team_map.get(m.away_id)
    if h is None or a is None:
        return None
    best: tuple[float, int] | None = None
    for fid, fh, fa, ko in fixtures:
        if fh != h or fa != a or ko is None:
            continue
        gap = abs((ko - m.kickoff_utc).total_seconds()) / 86400
        if gap <= max_days and (best is None or gap < best[0]):
            best = (gap, fid)
    return best[1] if best else None


def match_player(
    name: str,
    minutes: int,
    candidates: list[
        tuple[int, str, str, int | None]
    ],  # (player_id, full_name, web_name, fpl_minutes laga itu)
) -> tuple[int | None, float]:
    """Pemain Understat dalam satu laga → pemain kita di tim yang sama. Skor = nama 0.75 + menit 0.25."""
    best: tuple[float, int] | None = None
    for pid, full, web, mins in candidates:
        sim = max(name_similarity(name, full), name_similarity(name, web))
        if mins is None:
            minute_score = 0.5
        else:
            minute_score = 1.0 if abs(mins - minutes) <= 1 else 0.6 if abs(mins - minutes) <= 5 else 0.0
        score = 0.75 * sim + 0.25 * minute_score
        if best is None or score > best[0]:
            best = (score, pid)
    if best is None:
        return None, 0.0
    return best[1], round(best[0], 3)
