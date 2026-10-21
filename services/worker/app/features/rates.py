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
    return ratings_from_rows([(int(r.team), int(r.n), float(r.gf), float(r.ga)) for r in rows])


def ratings_from_rows(rows: list[tuple[int, int, float, float]]) -> tuple[dict[int, TeamRating], float]:
    """[(tim, laga, rata2 gol dicetak, rata2 kebobolan)] → rating ter-shrink + rata-rata gol liga."""
    if not rows:
        return {}, 1.35
    total_n = sum(n for _, n, _, _ in rows)
    league = sum(gf * n for _, n, gf, _ in rows) / max(1, total_n)
    out: dict[int, TeamRating] = {}
    for team, n, gf, ga in rows:
        prior_att, prior_def = PROMOTED_PRIOR if n < 10 else (1.0, 1.0)
        att = (gf / league * n + prior_att * TEAM_PRIOR_N) / (n + TEAM_PRIOR_N)
        dfn = (ga / league * n + prior_def * TEAM_PRIOR_N) / (n + TEAM_PRIOR_N)
        out[team] = TeamRating(att, dfn, n)
    return out, league


def team_rating(ratings: dict[int, TeamRating], team_id: int) -> TeamRating:
    return ratings.get(team_id) or TeamRating(*PROMOTED_PRIOR, 0)


@dataclass(frozen=True)
class RateParams:
    """Parameter rate pemain. Default = v1 produksi, disetel lewat backtest offline 2022/23–2025/26
    (recency + kalibrasi menit); Model Lab memvariasikannya (mis. "hot form")."""

    last_apps: int = LAST_APPS  # penampilan terakhir (menit > 0) lintas musim
    decay: float = 0.95  # bobot penampilan ke-i ke belakang = decay**i
    prev_weight: float = 0.5  # pengali bobot penampilan musim sebelumnya
    finishing: float = 0.15  # porsi gol/assist aktual yang dicampur ke xG/xA (0 = murni xG/xA)
    xmins_matches: int = 8  # laga tim musim berjalan untuk menit harapan
    xmins_alpha: float = 0.4  # EWMA menit (0 = rata-rata biasa)
    xmins_base: float = 5.5  # kalibrasi menit harapan: base + scale × rata-rata (bila > 0)
    xmins_scale: float = 0.85
    prior_min: float = PLAYER_PRIOR_MIN


def player_rates(
    conn: Connection, before: datetime, season_id: int, params: RateParams | None = None
) -> dict[int, dict[str, Any]]:
    """Rate (jumlah tertimbang + menit) dan menit harapan untuk semua pemain, as of `before`."""
    rp = params or RateParams()
    stats = conn.execute(
        text(
            """
            with m as (
              select s.player_id, s.minutes, s.expected_goals xg, s.expected_assists xa, s.bonus, s.saves,
                     s.yellow_cards yc, s.defensive_contribution dc, s.goals_scored g, s.assists a,
                     row_number() over (partition by s.player_id order by f.kickoff_utc desc) rn,
                     f.season_id = :s cur
              from public.player_fpl_gw_stats s
              join public.fixtures f on f.id = s.fixture_id
              where f.status = 'finished' and f.kickoff_utc < :before and s.minutes > 0
            ),
            w as (
              select *, power(:decay, rn - 1) * case when cur then 1 else :prev end w from m where rn <= :k
            )
            select player_id,
                   sum(w * minutes) mins,
                   sum(w * xg) filter (where xg is not null) xg,
                   sum(w * minutes) filter (where xg is not null) xg_mins,
                   sum(w * xa) filter (where xa is not null) xa,
                   sum(w * g) filter (where xg is not null) g,
                   sum(w * a) filter (where xa is not null) a,
                   sum(w * bonus) bonus, sum(w * saves) saves, sum(w * yc) yc,
                   sum(w) filter (where minutes >= 60 and dc is not null) dc_apps,
                   sum(w) filter (where minutes >= 60 and dc >= 10) dc10,
                   sum(w) filter (where minutes >= 60 and dc >= 12) dc12
            from w group by player_id
            """
        ),
        {
            "before": before,
            "s": season_id,
            "k": rp.last_apps,
            "decay": rp.decay,
            "prev": rp.prev_weight,
        },
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
            select player_id, sum(minutes * power(:keep, rn - 1)) / sum(power(:keep, rn - 1)) xmins
            from r where rn <= :n group by player_id
            """
        ),
        {"s": season_id, "before": before, "n": rp.xmins_matches, "keep": 1.0 - rp.xmins_alpha},
    ).all()
    out: dict[int, dict[str, Any]] = {
        int(r.player_id): {"xmins": calibrate_xmins(float(r.xmins or 0), rp)} for r in xmins
    }
    for r in stats:
        d = out.setdefault(int(r.player_id), {"xmins": 0.0})
        d.update(rate_totals(r._mapping, rp.finishing))
    return out


def calibrate_xmins(avg: float, rp: RateParams) -> float:
    """Menit rata-rata terakhir → menit harapan (regresi ke rata-rata: pemain 90 menit ≈ 82 menit)."""
    return min(90.0, rp.xmins_base + rp.xmins_scale * avg) if avg > 0 else 0.0


def rate_totals(r: Any, finishing: float) -> dict[str, float]:
    """Baris agregat → jumlah rate; xG/xA dicampur gol/assist aktual sebesar `finishing`."""
    xg, xa = float(r["xg"] or 0), float(r["xa"] or 0)
    return {
        "mins": float(r["mins"] or 0),
        "xg": (1 - finishing) * xg + finishing * float(r["g"] or 0),
        "xg_mins": float(r["xg_mins"] or 0),
        "xa": (1 - finishing) * xa + finishing * float(r["a"] or 0),
        "bonus": float(r["bonus"] or 0),
        "saves": float(r["saves"] or 0),
        "yc": float(r["yc"] or 0),
        "dc_apps": float(r["dc_apps"] or 0),
        "dc10": float(r["dc10"] or 0),
        "dc12": float(r["dc12"] or 0),
    }


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
        apps = float(m.get("dc_apps", 0))
        thr = rules.get(f"defcon_threshold_{pos}", 12.0)
        hits = float(m.get("dc10" if thr <= 10 else "dc12", 0))
        res["p_defcon"] = (hits + prior[pos]["p_defcon"] * 5) / (apps + 5)
        out[pid] = res
    return out
