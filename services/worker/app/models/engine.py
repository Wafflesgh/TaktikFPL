"""Konteks proyeksi xPts v1 (point-in-time) — dipakai run_projections (live) dan evaluate_model (backtest)."""

from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.features.rates import TeamRating, player_rates, shrunk_rates, team_rating, team_ratings
from app.features.tactics import PlayerTactics, TeamStyle, player_tactics, team_styles
from app.models.xpts_v1 import MODEL_VERSION, MatchRates, PlayerRates, project_v1

__all__ = ["MODEL_VERSION", "Context", "build_context", "p_play", "project"]

UNAVAILABLE = {"i", "s", "u", "n"}


@dataclass
class Context:
    rules: dict[str, float]
    ratings: dict[int, TeamRating]
    league_goals: float
    rates: dict[int, dict[str, float]]
    # Data taktik Understat (kosong bila belum ada → pengali 1, model kembali ke v1 dasar).
    styles: dict[int, TeamStyle] = field(default_factory=dict)
    tactics: dict[int, PlayerTactics] = field(default_factory=dict)


def scoring_rules(conn: Connection, season_id: int) -> dict[str, float]:
    return {
        r.rule_key: float(r.value)
        for r in conn.execute(
            text("select rule_key, value from public.fpl_scoring_rules where season_id = :s"),
            {"s": season_id},
        )
    }


def build_context(conn: Connection, before: datetime, season_id: int, positions: dict[int, str]) -> Context:
    rules = scoring_rules(conn, season_id)
    ratings, league = team_ratings(conn, before)
    raw = player_rates(conn, before, season_id)
    return Context(
        rules,
        ratings,
        league,
        shrunk_rates(raw, positions, rules),
        styles=team_styles(conn, before),
        tactics=player_tactics(conn, before),
    )


def p_play(status: str | None, chance_next: int | None) -> float:
    if status in UNAVAILABLE:
        return 0.0
    if chance_next is not None:
        return max(0.0, min(1.0, chance_next / 100))
    return 1.0


def project(
    ctx: Context, player_id: int, position: str, team_id: int, opp_id: int, is_home: bool, play: float = 1.0
) -> dict[str, Any]:
    r = ctx.rates.get(player_id, {})
    tr, orr = team_rating(ctx.ratings, team_id), team_rating(ctx.ratings, opp_id)
    pr = PlayerRates(
        position=position,
        xmins=float(r.get("xmins", 0.0)),
        p_play=play,
        xg90=float(r.get("xg90", 0.0)),
        xa90=float(r.get("xa90", 0.0)),
        bonus90=float(r.get("bonus90", 0.0)),
        saves90=float(r.get("saves90", 0.0)),
        yc90=float(r.get("yc90", 0.0)),
        p_defcon=float(r.get("p_defcon", 0.0)),
    )
    # Gaya lawan (low block / high press) × rekam jejak pemain melawan gaya itu (ter-shrink, dibatasi).
    style = ctx.styles.get(opp_id)
    tac = ctx.tactics.get(player_id)
    mult = tac.mult(style.bucket) if (style and tac) else 1.0
    if mult != 1.0:
        pr = replace(pr, xg90=pr.xg90 * mult, xa90=pr.xa90 * mult)
    mr = MatchRates(tr.att, tr.defn, orr.att, orr.defn, is_home, ctx.league_goals)
    out: dict[str, Any] = dict(project_v1(pr, mr, ctx.rules))
    out["style_mult"] = round(mult, 3)
    if style:
        out["opp_style"] = style.bucket
        out["opp_ppda"] = round(style.ppda, 2)
        out["opp_rank_passive"] = style.rank_passive
        out["opp_n_teams"] = style.n_teams
    return out
