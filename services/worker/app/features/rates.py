"""Rate pemain & tim untuk xPts v1, dihitung *as of* waktu tertentu (point-in-time, tanpa data masa depan).

- Pemain: 30 penampilan terakhir lintas musim (xG/xA hanya laga yang punya nilai, mulai 2022/23),
  di-shrink ke rata-rata posisi dengan prior 450 menit. Menit harapan = rata-rata menit 5 laga tim
  terakhir musim berjalan (0 bila tidak dimainkan).
- Tim: 19 laga PL terakhir lintas musim; gol "pantas" = jumlah xG pemain tim (fallback gol aktual
  untuk musim tanpa xG), dinormalisasi ke rata-rata liga dan di-shrink (prior 6 laga). Tim dengan
  < 10 laga PL di data (umumnya promosi) memakai prior lebih lemah.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

PLAYER_PRIOR_MIN = 450.0
TEAM_PRIOR_N = 6.0
PROMOTED_PRIOR = (0.85, 1.15)  # (serang, bertahan) untuk tim dengan data PL sedikit
LAST_APPS = 30
LAST_TEAM_MATCHES = 19


@dataclass(frozen=True)
class TeamRating:
    att: float
    defn: float
    matches: int


def team_ratings(conn: Connection, before: datetime) -> tuple[dict[int, TeamRating], float]:
    rows = conn.execute(
        text(
            """
            with fx as (
              select f.id, f.kickoff_utc, f.home_team_id h, f.away_team_id a, f.home_goals hg, f.away_goals ag
              from public.fixtures f
              join public.competitions c on c.id = f.competition_id and c.code = 'PL'
              where f.status = 'finished' and f.kickoff_utc < :before and f.home_goals is not null
            ),
            xg as (
              select s.fixture_id, s.team_id, sum(s.expected_goals) xg, count(s.expected_goals) n
              from public.player_fpl_gw_stats s where s.team_id is not null group by 1, 2
            ),
            tm as (
              select fx.kickoff_utc, fx.h team,
                     case when xh.n > 0 then xh.xg else fx.hg end gf,
                     case when xa.n > 0 then xa.xg else fx.ag end ga
              from fx left join xg xh on xh.fixture_id = fx.id and xh.team_id = fx.h
                      left join xg xa on xa.fixture_id = fx.id and xa.team_id = fx.a
              union all
              select fx.kickoff_utc, fx.a team,
                     case when xa.n > 0 then xa.xg else fx.ag end gf,
                     case when xh.n > 0 then xh.xg else fx.hg end ga
              from fx left join xg xh on xh.fixture_id = fx.id and xh.team_id = fx.h
                      left join xg xa on xa.fixture_id = fx.id and xa.team_id = fx.a
            ),
            ranked as (
              select *, row_number() over (partition by team order by kickoff_utc desc) rn from tm
            )
            select team, count(*) n, avg(gf) gf, avg(ga) ga from ranked where rn <= :k group by team
            """
        ),
        {"before": before, "k": LAST_TEAM_MATCHES},
    ).all()
    if not rows:
        return {}, 1.35
    total_n = sum(int(r.n) for r in rows)
    league = sum(float(r.gf) * int(r.n) for r in rows) / max(1, total_n)
    out: dict[int, TeamRating] = {}
    for r in rows:
        n = int(r.n)
        prior_att, prior_def = PROMOTED_PRIOR if n < 10 else (1.0, 1.0)
        att = (float(r.gf) / league * n + prior_att * TEAM_PRIOR_N) / (n + TEAM_PRIOR_N)
        dfn = (float(r.ga) / league * n + prior_def * TEAM_PRIOR_N) / (n + TEAM_PRIOR_N)
        out[int(r.team)] = TeamRating(att, dfn, n)
    return out, league


def team_rating(ratings: dict[int, TeamRating], team_id: int) -> TeamRating:
    return ratings.get(team_id) or TeamRating(*PROMOTED_PRIOR, 0)


def player_rates(
    conn: Connection, before: datetime, season_id: int, last_apps: int = LAST_APPS, xmins_matches: int = 5
) -> dict[int, dict[str, Any]]:
    """Rate per 90 (mentah + menit) dan menit harapan untuk semua pemain musim berjalan.

    last_apps / xmins_matches divariasikan oleh Model Lab (mis. model "hot form", "nailed-first")."""
    stats = conn.execute(
        text(
            """
            with m as (
              select s.player_id, s.minutes, s.expected_goals xg, s.expected_assists xa, s.bonus, s.saves,
                     s.yellow_cards yc, s.defensive_contribution dc,
                     row_number() over (partition by s.player_id order by f.kickoff_utc desc) rn
              from public.player_fpl_gw_stats s
              join public.fixtures f on f.id = s.fixture_id
              where f.status = 'finished' and f.kickoff_utc < :before and s.minutes > 0
            )
            select player_id,
                   sum(minutes) mins,
                   sum(xg) filter (where xg is not null) xg,
                   sum(minutes) filter (where xg is not null) xg_mins,
                   sum(xa) filter (where xa is not null) xa,
                   sum(bonus) bonus, sum(saves) saves, sum(yc) yc,
                   count(*) filter (where minutes >= 60 and dc is not null) dc_apps,
                   count(*) filter (where minutes >= 60 and dc >= 10) dc10,
                   count(*) filter (where minutes >= 60 and dc >= 12) dc12
            from m where rn <= :k group by player_id
            """
        ),
        {"before": before, "k": last_apps},
    ).all()
    xmins = conn.execute(
        text(
            """
            with r as (
              select s.player_id, s.minutes,
                     row_number() over (partition by s.player_id order by f.kickoff_utc desc) rn
              from public.player_fpl_gw_stats s
              join public.fixtures f on f.id = s.fixture_id
              where f.season_id = :s and f.status = 'finished' and f.kickoff_utc < :before
            )
            select player_id, avg(minutes) xmins from r where rn <= :n group by player_id
            """
        ),
        {"s": season_id, "before": before, "n": xmins_matches},
    ).all()
    out: dict[int, dict[str, Any]] = {int(r.player_id): {"xmins": float(r.xmins or 0)} for r in xmins}
    for r in stats:
        d = out.setdefault(int(r.player_id), {"xmins": 0.0})
        d.update(
            mins=float(r.mins or 0),
            xg=float(r.xg or 0),
            xg_mins=float(r.xg_mins or 0),
            xa=float(r.xa or 0),
            bonus=float(r.bonus or 0),
            saves=float(r.saves or 0),
            yc=float(r.yc or 0),
            dc_apps=int(r.dc_apps or 0),
            dc10=int(r.dc10 or 0),
            dc12=int(r.dc12 or 0),
        )
    return out


def _per90(total: float, minutes: float) -> float:
    return 90.0 * total / minutes if minutes > 0 else 0.0


def shrunk_rates(
    raw: dict[int, dict[str, Any]],
    positions: dict[int, str],
    rules: dict[str, float],
    prior_min: float = PLAYER_PRIOR_MIN,
) -> dict[int, dict[str, float]]:
    """Per 90 ter-shrink ke rata-rata posisi + peluang DefCon per laga ≥60 menit."""
    keys = {"xg": "xg_mins", "xa": "xg_mins", "bonus": "mins", "saves": "mins", "yc": "mins"}
    prior: dict[str, dict[str, float]] = {}
    for pos in set(positions.values()):
        members = [raw[p] for p, ps in positions.items() if ps == pos and p in raw]
        prior[pos] = {}
        for k, mk in keys.items():
            mins = sum(m.get(mk, 0.0) for m in members)
            prior[pos][k] = _per90(sum(m.get(k, 0.0) for m in members), mins)
        apps = sum(m.get("dc_apps", 0) for m in members)
        thr = rules.get(f"defcon_threshold_{pos}", 12.0)
        hits = sum(m.get("dc10" if thr <= 10 else "dc12", 0) for m in members)
        prior[pos]["p_defcon"] = hits / apps if apps else 0.0

    out: dict[int, dict[str, float]] = {}
    for pid, pos in positions.items():
        m = raw.get(pid, {})
        res: dict[str, float] = {"xmins": float(m.get("xmins", 0.0))}
        for k, mk in keys.items():
            mins = float(m.get(mk, 0.0))
            obs = _per90(float(m.get(k, 0.0)), mins)
            res[f"{k}90"] = (obs * mins + prior[pos][k] * prior_min) / (mins + prior_min)
        apps = int(m.get("dc_apps", 0))
        thr = rules.get(f"defcon_threshold_{pos}", 12.0)
        hits = int(m.get("dc10" if thr <= 10 else "dc12", 0))
        res["p_defcon"] = (hits + prior[pos]["p_defcon"] * 5) / (apps + 5)
        out[pid] = res
    return out
