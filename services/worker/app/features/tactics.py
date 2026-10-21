"""Fitur taktik dari data Understat (point-in-time: hanya laga sebelum `before`).

Gaya tim (BLUEPRINT 4.3.1):
- low_block / high_press dari PPDA (umpan lawan per aksi bertahan; tinggi = pasif, bertahan dalam).
- territory dari deep completions; leaky dari xGA.
Skor 0..1 = persentil di antara tim yang punya data (bukan ambang hardcode per klub).

Profil pemain:
- peran: distribusi posisi Understat (AMR, FW, DMC, ...) di start terakhir.
- split lawan: xG+xA/90 melawan tim low-block vs high-press vs keseluruhan, di-shrink ke rata-rata
  pemain itu sendiri (prior STYLE_PRIOR_90 laga) supaya sampel kecil tidak menghasilkan angka ekstrem.
- porsi xG dari bola mati.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

TEAM_WINDOW = 19
LOW_BLOCK_PCT = 2 / 3  # sepertiga tim paling pasif = low block
HIGH_PRESS_PCT = 1 / 3
STYLE_PRIOR_90 = 5.0  # prior shrinkage: setara 5 laga penuh
ROLE_WINDOW = 20
STYLE_LOOKBACK_DAYS = 760  # ±2 musim
MULT_MIN, MULT_MAX = 0.85, 1.2
SET_PIECES = {"SetPiece", "FromCorner", "DirectFreekick", "Penalty"}


def percentile(value: float, population: list[float]) -> float:
    if not population:
        return 0.5
    below = sum(1 for v in population if v < value)
    equal = sum(1 for v in population if v == value)
    return (below + 0.5 * equal) / len(population)


@dataclass
class TeamStyle:
    team_id: int
    matches: int
    ppda: float
    deep: float
    deep_allowed: float
    xg: float
    xga: float
    low_block: float = 0.5  # persentil PPDA (1 = paling pasif)
    territory: float = 0.5
    leaky: float = 0.5
    rank_passive: int = 0  # 1 = paling pasif di liga
    n_teams: int = 0

    @property
    def bucket(self) -> str:
        if self.low_block >= LOW_BLOCK_PCT:
            return "low_block"
        if self.low_block <= HIGH_PRESS_PCT:
            return "high_press"
        return "mid_block"

    def tags(self) -> dict[str, float]:
        return {
            "low_block": round(self.low_block, 3),
            "high_press": round(1 - self.low_block, 3),
            "mid_block": round(1 - abs(2 * self.low_block - 1), 3),
            "territorial": round(self.territory, 3),
            "leaky": round(self.leaky, 3),
        }


def team_styles(
    conn: Connection, before: datetime, team_ids: list[int] | None = None
) -> dict[int, TeamStyle]:
    rows = conn.execute(
        text(
            """
            with r as (
              select tms.team_id, tms.ppda, tms.deep_completions deep,
                     (tms.extra ->> 'deep_allowed')::numeric deep_allowed, tms.xg, tms.xga,
                     row_number() over (partition by tms.team_id order by f.kickoff_utc desc) rn
              from public.team_match_stats tms join public.fixtures f on f.id = tms.fixture_id
              where tms.source = 'understat' and f.kickoff_utc < :b and tms.ppda is not null
            )
            select team_id, count(*) n, avg(ppda) ppda, avg(deep) deep, avg(deep_allowed) deep_allowed,
                   avg(xg) xg, avg(xga) xga
            from r where rn <= :w group by team_id
            """
        ),
        {"b": before, "w": TEAM_WINDOW},
    ).all()
    styles = {
        int(r.team_id): TeamStyle(
            int(r.team_id),
            int(r.n),
            float(r.ppda),
            float(r.deep or 0),
            float(r.deep_allowed or 0),
            float(r.xg or 0),
            float(r.xga or 0),
        )
        for r in rows
        if team_ids is None or int(r.team_id) in team_ids
    }
    pop = list(styles.values())
    ppdas = [s.ppda for s in pop]
    for s in pop:
        s.low_block = percentile(s.ppda, ppdas)
        s.territory = percentile(s.deep, [t.deep for t in pop])
        s.leaky = percentile(s.xga, [t.xga for t in pop])
        s.rank_passive = 1 + sum(1 for t in pop if t.ppda > s.ppda)
        s.n_teams = len(pop)
    return styles


@dataclass
class PlayerTactics:
    player_id: int
    roles: dict[str, float] = field(default_factory=dict)  # posisi → porsi start
    starts: int = 0
    minutes: int = 0
    xgi90: float = 0.0
    split: dict[str, dict[str, float]] = field(
        default_factory=dict
    )  # bucket → {minutes, xgi90, shrunk, ratio}
    set_piece_xg_share: float = 0.0
    xg_chain90: float = 0.0

    @property
    def primary_role(self) -> str | None:
        return max(self.roles.items(), key=lambda kv: kv[1])[0] if self.roles else None

    def mult(self, bucket: str) -> float:
        s = self.split.get(bucket)
        return s["ratio"] if s else 1.0

    def to_json(self) -> dict[str, Any]:
        return {
            "roles": {k: round(v, 3) for k, v in self.roles.items()},
            "primary_role": self.primary_role,
            "starts": self.starts,
            "minutes": self.minutes,
            "xgi90": round(self.xgi90, 3),
            "split": self.split,
            "set_piece_xg_share": round(self.set_piece_xg_share, 3),
            "xg_chain90": round(self.xg_chain90, 3),
        }


def _opponent_bucket_by_season(conn: Connection, before: datetime) -> dict[tuple[int, int], str]:
    """(season_id, team_id) → bucket gaya tim itu sepanjang musim (sampai `before`)."""
    rows = conn.execute(
        text(
            """
            select f.season_id, tms.team_id, avg(tms.ppda) ppda
            from public.team_match_stats tms join public.fixtures f on f.id = tms.fixture_id
            where tms.source = 'understat' and f.kickoff_utc < :b and tms.ppda is not null
            group by 1, 2
            """
        ),
        {"b": before},
    ).all()
    by_season: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for r in rows:
        by_season[int(r.season_id)].append((int(r.team_id), float(r.ppda)))
    out: dict[tuple[int, int], str] = {}
    for season, teams in by_season.items():
        pop = [p for _, p in teams]
        for team, p in teams:
            pct = percentile(p, pop)
            out[(season, team)] = (
                "low_block"
                if pct >= LOW_BLOCK_PCT
                else "high_press"
                if pct <= HIGH_PRESS_PCT
                else "mid_block"
            )
    return out


def player_tactics(conn: Connection, before: datetime) -> dict[int, PlayerTactics]:
    buckets = _opponent_bucket_by_season(conn, before)
    rows = conn.execute(
        text(
            """
            select s.player_id, s.minutes, s.xg, s.xa, (s.extra ->> 'xg_chain')::numeric xg_chain,
                   s.extra ->> 'position' pos, f.season_id, f.kickoff_utc,
                   case when f.home_team_id = s.team_id then f.away_team_id else f.home_team_id end opp
            from public.player_match_stats s join public.fixtures f on f.id = s.fixture_id
            where s.source = 'understat' and f.kickoff_utc < :b
              and f.kickoff_utc >= cast(:b as timestamptz) - make_interval(days => :d)
            order by f.kickoff_utc desc
            """
        ),
        {"b": before, "d": STYLE_LOOKBACK_DAYS},
    ).all()
    sp = {
        int(r.player_id): (float(r.sp or 0), float(r.total or 0))
        for r in conn.execute(
            text(
                """
                select sh.player_id,
                       sum(sh.xg) filter (where sh.situation = any(:sp)) sp, sum(sh.xg) total
                from public.shots sh join public.fixtures f on f.id = sh.fixture_id
                where sh.player_id is not null and f.kickoff_utc < :b
                  and f.kickoff_utc >= cast(:b as timestamptz) - make_interval(days => :d)
                group by sh.player_id
                """
            ),
            {"b": before, "d": STYLE_LOOKBACK_DAYS, "sp": list(SET_PIECES)},
        )
    }
    acc: dict[int, dict[str, Any]] = defaultdict(
        lambda: {
            "roles": Counter(),
            "starts": 0,
            "min": 0,
            "xgi": 0.0,
            "chain": 0.0,
            "b": defaultdict(lambda: [0, 0.0]),
        }
    )
    for r in rows:
        a = acc[int(r.player_id)]
        mins = int(r.minutes or 0)
        if r.pos and r.pos != "Sub" and a["starts"] < ROLE_WINDOW:
            a["roles"][r.pos] += 1
            a["starts"] += 1
        a["min"] += mins
        xgi = float(r.xg or 0) + float(r.xa or 0)
        a["xgi"] += xgi
        a["chain"] += float(r.xg_chain or 0)
        b = buckets.get((int(r.season_id), int(r.opp)))
        if b:
            a["b"][b][0] += mins
            a["b"][b][1] += xgi
    out: dict[int, PlayerTactics] = {}
    for pid, a in acc.items():
        n90 = a["min"] / 90.0
        rate = a["xgi"] / n90 if n90 > 0 else 0.0
        split: dict[str, dict[str, float]] = {}
        for bucket, (mins, xgi) in a["b"].items():
            b90 = mins / 90.0
            shrunk = (xgi + rate * STYLE_PRIOR_90) / (b90 + STYLE_PRIOR_90)
            ratio = shrunk / rate if rate > 0 else 1.0
            split[bucket] = {
                "minutes": mins,
                "xgi90": round(xgi / b90, 3) if b90 > 0 else 0.0,
                "shrunk": round(shrunk, 3),
                "ratio": round(min(MULT_MAX, max(MULT_MIN, ratio)), 3),
            }
        sp_xg, total_xg = sp.get(pid, (0.0, 0.0))
        starts = a["starts"]
        out[pid] = PlayerTactics(
            player_id=pid,
            roles={k: v / starts for k, v in a["roles"].items()} if starts else {},
            starts=starts,
            minutes=a["min"],
            xgi90=rate,
            split=split,
            set_piece_xg_share=sp_xg / total_xg if total_xg > 0 else 0.0,
            xg_chain90=a["chain"] / n90 if n90 > 0 else 0.0,
        )
    return out
