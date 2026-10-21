"""Data satu GW untuk Model Lab, point-in-time: hanya informasi yang ada sebelum deadline GW itu.

Dipakai untuk backtest (musim lalu & musim berjalan) maupun prediksi live (GW berikutnya).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection

HISTORY_ROWS = 38


@dataclass(frozen=True)
class PInfo:
    position: str
    team: int
    price: int  # persepuluhan £ (harga terakhir yang diketahui sebelum deadline)
    selected: int  # jumlah manajer pemilik (sinyal "crowd")


@dataclass(frozen=True)
class Fx:
    gw: int
    opp: int
    home: bool
    fdr: int


@dataclass
class GwBundle:
    season_id: int
    gw: int
    gw_id: int
    deadline: datetime
    gws: list[int]  # GW horizon (g .. g+H-1) yang ada di musim
    players: dict[int, PInfo]
    fixtures: dict[int, list[Fx]]  # tim → laga di GW horizon
    history: dict[int, list[tuple[int, int, bool]]]  # pemain → [(poin, menit, musim_ini)] terbaru dulu
    actual: dict[int, tuple[int, int]] = field(default_factory=dict)  # pemain → (poin, menit) GW g
    fpl_xp: dict[int, float] = field(default_factory=dict)  # xP resmi FPL untuk GW g (bila ada)

    def n_fixtures(self, team: int, gw: int) -> int:
        return sum(1 for f in self.fixtures.get(team, []) if f.gw == gw)


def season_gameweeks(conn: Connection, season_id: int) -> list[tuple[int, int, datetime, bool]]:
    """[(gw_id, nomor, deadline, selesai)] urut nomor."""
    return [
        (int(r.id), int(r.number), r.deadline_utc, bool(r.is_finished))
        for r in conn.execute(
            text(
                "select id, number, deadline_utc, is_finished from public.gameweeks "
                "where season_id = :s order by number"
            ),
            {"s": season_id},
        )
    ]


def load_bundle(
    conn: Connection,
    season_id: int,
    gw: int,
    horizon: int,
    gameweeks: list[tuple[int, int, datetime, bool]],
    with_actual: bool = True,
) -> GwBundle:
    by_num = {n: (gid, dl) for gid, n, dl, _ in gameweeks}
    gw_id, deadline = by_num[gw]
    gws = [g for g in range(gw, gw + horizon) if g in by_num]
    gid_to_num = {by_num[g][0]: g for g in gws}

    fixtures: dict[int, list[Fx]] = defaultdict(list)
    for r in conn.execute(
        text(
            """
            select gameweek_id, home_team_id, away_team_id, difficulty_home, difficulty_away
            from public.fixtures
            where gameweek_id = any(:g) and status not in ('postponed','cancelled','abandoned')
            """
        ),
        {"g": list(gid_to_num)},
    ):
        g = gid_to_num[int(r.gameweek_id)]
        fixtures[int(r.home_team_id)].append(Fx(g, int(r.away_team_id), True, int(r.difficulty_home or 3)))
        fixtures[int(r.away_team_id)].append(Fx(g, int(r.home_team_id), False, int(r.difficulty_away or 3)))

    # Tim & harga = baris FPL terakhir sebelum deadline; fallback ke data musim (pemain baru).
    latest = {
        int(r.player_id): r
        for r in conn.execute(
            text(
                """
                select distinct on (s.player_id) s.player_id, s.team_id, s.value_tenths, s.selected
                from public.player_fpl_gw_stats s join public.fixtures f on f.id = s.fixture_id
                where f.season_id = :s and f.kickoff_utc < :d
                order by s.player_id, f.kickoff_utc desc
                """
            ),
            {"s": season_id, "d": deadline},
        )
    }
    first_price = {
        int(r.player_id): int(r.value_tenths)
        for r in conn.execute(
            text(
                """
                select distinct on (s.player_id) s.player_id, s.value_tenths
                from public.player_fpl_gw_stats s join public.fixtures f on f.id = s.fixture_id
                where f.season_id = :s and s.value_tenths is not null
                order by s.player_id, f.kickoff_utc
                """
            ),
            {"s": season_id},
        )
    }
    players: dict[int, PInfo] = {}
    for r in conn.execute(
        text(
            """
            select distinct on (player_id) player_id, fpl_position, team_id from public.player_seasons
            where season_id = :s and fpl_position is not null
            order by player_id, joined_on desc nulls last
            """
        ),
        {"s": season_id},
    ):
        pid = int(r.player_id)
        lt = latest.get(pid)
        team = int(lt.team_id) if lt is not None and lt.team_id is not None else int(r.team_id)
        price = int(lt.value_tenths) if lt is not None and lt.value_tenths else first_price.get(pid, 0)
        if not price:
            continue
        players[pid] = PInfo(r.fpl_position, team, price, int(lt.selected or 0) if lt is not None else 0)

    history: dict[int, list[tuple[int, int, bool]]] = defaultdict(list)
    for r in conn.execute(
        text(
            """
            with h as (
              select s.player_id, s.total_points, s.minutes, f.season_id = :s this_season,
                     row_number() over (partition by s.player_id order by f.kickoff_utc desc) rn
              from public.player_fpl_gw_stats s join public.fixtures f on f.id = s.fixture_id
              where f.kickoff_utc < :d and f.status = 'finished' and s.player_id = any(:p)
            )
            select player_id, total_points, minutes, this_season from h where rn <= :k order by player_id, rn
            """
        ),
        {"s": season_id, "d": deadline, "p": list(players), "k": HISTORY_ROWS},
    ):
        history[int(r.player_id)].append((int(r.total_points or 0), int(r.minutes or 0), bool(r.this_season)))

    bundle = GwBundle(season_id, gw, gw_id, deadline, gws, players, dict(fixtures), dict(history))
    if with_actual:
        for r in conn.execute(
            text(
                """
                select player_id, sum(total_points) pts, sum(minutes) mins, avg(fpl_xp) xp
                from public.player_fpl_gw_stats where gameweek_id = :g group by player_id
                """
            ),
            {"g": gw_id},
        ):
            bundle.actual[int(r.player_id)] = (int(r.pts or 0), int(r.mins or 0))
            if r.xp is not None:
                bundle.fpl_xp[int(r.player_id)] = float(r.xp)
    return bundle
