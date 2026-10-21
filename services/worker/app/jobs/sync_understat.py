"""sync_understat: data taktik PL dari Understat → team_match_stats (PPDA, deep), lineups (peran per laga),
player_match_stats (xG/xA/xGChain), shots (situasi) + pemetaan id eksternal.

    sync_understat()                                  # musim berjalan, laga baru saja
    sync_understat(seasons="2025/26,2026/27", max_matches=400)   # backfill (sekali)

Arsip (ADR 0001): getLeagueData harian, getMatchData sekali per laga (reason gw_final/backfill).
"""

import json
from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.archive.store import archive_payload, last_archived_at
from app.db import get_engine
from app.features.tactics import player_tactics, team_styles
from app.scheduler.runner import JobSkipped, job
from app.sources.understat import (
    UnderstatClient,
    UTeamMatch,
    match_fixture,
    match_player,
    match_teams,
    name_similarity,
    parse_match,
    parse_matches,
    parse_team_history,
    season_year,
)

log = structlog.get_logger()

PLAYER_MATCH_MIN = 0.75  # skor minimum pencocokan pemain otomatis
TRANSFER_NAME_MIN = 0.92  # kemiripan nama minimum bila dicari di luar tim laga (pemain sudah pindah)
LEAGUE_ARCHIVE_EVERY = timedelta(hours=20)


def _season_ids(conn: Connection, seasons: str | None) -> list[tuple[int, str]]:
    if seasons:
        labels = [s.strip() for s in seasons.split(",") if s.strip()]
        rows = conn.execute(
            text("select id, label from public.seasons where label = any(:l)"), {"l": labels}
        ).all()
    else:
        rows = conn.execute(text("select id, label from public.seasons where is_current")).all()
    return [(int(r.id), r.label) for r in rows]


def _team_fixture(tm: UTeamMatch, team_map: dict[int, int], fixtures: Sequence[Any]) -> int | None:
    team = team_map.get(tm.team_id)
    if team is None:
        return None
    best: tuple[float, int] | None = None
    for f in fixtures:
        if f.kickoff_utc is None or (f.home_team_id if tm.is_home else f.away_team_id) != team:
            continue
        gap = abs((f.kickoff_utc - tm.kickoff_utc).total_seconds()) / 86400
        if gap <= 4 and (best is None or gap < best[0]):
            best = (gap, int(f.id))
    return best[1] if best else None


def _best_by_name(name: str, cands: list[tuple[int, str, str, int | None]]) -> tuple[int | None, float]:
    best: tuple[float, int] | None = None
    for pid, full, web, _ in cands:
        sim = max(name_similarity(name, full), name_similarity(name, web))
        if best is None or sim > best[0]:
            best = (sim, pid)
    return (best[1], best[0]) if best else (None, 0.0)


def _store_match(
    conn: Connection,
    fixture_id: int,
    season_id: int,
    payload: dict[str, Any],
    match_id: int,
    team_map: dict[int, int],
    known: dict[str, int],
    season_players: dict[int, list[tuple[int, str, str]]],
) -> dict[str, int]:
    """Satu laga → lineups, player_match_stats, shots. Ditulis batch (satu executemany per tabel)
    karena DB di Sydney dan runner GitHub di AS: per-baris akan memakan jam saat backfill."""
    rosters, shots = parse_match(payload, match_id)
    fpl_minutes = {
        int(r.player_id): int(r.minutes or 0)
        for r in conn.execute(
            text("select player_id, minutes from public.player_fpl_gw_stats where fixture_id = :f"),
            {"f": fixture_id},
        )
    }
    cands = {
        team: [(pid, full, web, fpl_minutes.get(pid)) for pid, full, web in players]
        for team, players in season_players.items()
    }
    lineup_rows: list[dict[str, Any]] = []
    stat_rows: list[dict[str, Any]] = []

    pid_of: dict[int, int] = {}  # id pemain Understat → id kita
    name_to_pid: dict[str, int] = {}
    stats = {"rosters": 0, "matched": 0, "unmatched": 0, "shots": 0}
    for ro in rosters:
        stats["rosters"] += 1
        team = team_map.get(ro.team_id)
        pid = known.get(str(ro.player_id))
        if pid is None and team is not None:
            cand, score = match_player(ro.name, ro.minutes, cands.get(team, []))
            if cand is None or score < PLAYER_MATCH_MIN:
                # Pemain yang pindah klub sesudah laga ini: cari di seluruh musim, nama harus hampir identik.
                every = [c for players in cands.values() for c in players]
                alt, alt_name = _best_by_name(ro.name, every)
                if alt is not None and alt_name >= TRANSFER_NAME_MIN:
                    cand, score = alt, round(0.9 * alt_name, 3)
            if cand is not None and score >= PLAYER_MATCH_MIN:
                pid = cand
                conn.execute(
                    text(
                        """
                        insert into public.player_external_ids
                          (player_id, source, external_id, match_confidence)
                        values (:p, 'understat', :e, :c) on conflict (source, external_id) do nothing
                        """
                    ),
                    {"p": pid, "e": str(ro.player_id), "c": min(score, 1.0)},
                )
                known[str(ro.player_id)] = pid
            else:
                conn.execute(
                    text(
                        """
                        insert into public.unmatched_entities
                          (entity_type, source, external_id, raw_name, context, best_candidate_id, best_score)
                        values ('player', 'understat', :e, :n, cast(:ctx as jsonb), :b, :sc)
                        on conflict (source, entity_type, external_id) do update
                          set best_candidate_id = excluded.best_candidate_id, best_score = excluded.best_score
                        """
                    ),
                    {
                        "e": str(ro.player_id),
                        "n": ro.name,
                        "ctx": json.dumps({"fixture_id": fixture_id, "team_id": team, "minutes": ro.minutes}),
                        "b": cand,
                        "sc": score,
                    },
                )
        if pid is None or team is None:
            stats["unmatched"] += 1
            continue
        stats["matched"] += 1
        pid_of[ro.player_id] = pid
        name_to_pid[ro.name] = pid
        pen_xg = sum(s.xg for s in shots if s.player_id == ro.player_id and s.situation == "Penalty")
        lineup_rows.append(
            {
                "f": fixture_id,
                "t": team,
                "p": pid,
                "st": ro.position != "Sub",
                "pos": ro.position,
                "ord": str(ro.position_order),
            },
        )
        stat_rows.append(
            {
                "f": fixture_id,
                "p": pid,
                "t": team,
                "min": ro.minutes,
                "g": ro.goals,
                "a": ro.assists,
                "sh": ro.shots,
                "xg": round(ro.xg, 3),
                "npxg": round(max(0.0, ro.xg - pen_xg), 3),
                "xa": round(ro.xa, 3),
                "kp": ro.key_passes,
                "y": ro.yellow,
                "r": ro.red,
                "extra": json.dumps(
                    {
                        "position": ro.position,
                        "position_order": ro.position_order,
                        "xg_chain": round(ro.xg_chain, 3),
                        "xg_buildup": round(ro.xg_buildup, 3),
                        "own_goals": ro.own_goals,
                        "understat_player_id": ro.player_id,
                    }
                ),
            },
        )
    home_team, away_team = (
        next((team_map.get(r.team_id) for r in rosters if r.is_home), None),
        next((team_map.get(r.team_id) for r in rosters if not r.is_home), None),
    )
    shot_rows = [
        {
            "f": fixture_id,
            "e": str(sh.id),
            "p": pid_of.get(sh.player_id),
            "t": home_team if sh.is_home else away_team,
            "m": sh.minute,
            "x": round(sh.x, 3),
            "y": round(sh.y, 3),
            "xg": round(sh.xg, 4),
            "res": sh.result,
            "sit": sh.situation,
            "st": sh.shot_type,
            "la": sh.last_action,
            "ap": name_to_pid.get(sh.assisted_by or ""),
        }
        for sh in shots
    ]
    if lineup_rows:
        conn.execute(
            text(
                """
                insert into public.lineups
                  (fixture_id, team_id, player_id, is_starter, position_label, grid_position,
                   source, updated_at)
                values (:f, :t, :p, :st, :pos, :ord, 'understat', now())
                on conflict (fixture_id, player_id) do update set
                  team_id = excluded.team_id, is_starter = excluded.is_starter,
                  position_label = excluded.position_label, grid_position = excluded.grid_position,
                  source = excluded.source, updated_at = now()
                """
            ),
            lineup_rows,
        )
    if stat_rows:
        conn.execute(
            text(
                """
                insert into public.player_match_stats
                  (fixture_id, player_id, team_id, source, minutes, goals, assists, shots, xg, npxg, xa,
                   key_passes, yellow_cards, red_cards, extra, updated_at)
                values (:f, :p, :t, 'understat', :min, :g, :a, :sh, :xg, :npxg, :xa, :kp, :y, :r,
                        cast(:extra as jsonb), now())
                on conflict (fixture_id, player_id, source) do update set
                  minutes = excluded.minutes, goals = excluded.goals, assists = excluded.assists,
                  shots = excluded.shots, xg = excluded.xg, npxg = excluded.npxg, xa = excluded.xa,
                  key_passes = excluded.key_passes, yellow_cards = excluded.yellow_cards,
                  red_cards = excluded.red_cards, extra = excluded.extra, updated_at = now()
                """
            ),
            stat_rows,
        )
    if shot_rows:
        conn.execute(
            text(
                """
                insert into public.shots
                  (fixture_id, source, external_shot_id, player_id, team_id, minute, x, y, xg, result,
                   situation, shot_type, last_action, assist_player_id)
                values (:f, 'understat', :e, :p, :t, :m, :x, :y, :xg, :res, :sit, :st, :la, :ap)
                on conflict (source, external_shot_id) do update set
                  player_id = excluded.player_id, assist_player_id = excluded.assist_player_id
                """
            ),
            shot_rows,
        )
    stats["shots"] = len(shot_rows)
    return stats


@job("sync_understat")
def sync_understat(seasons: str | None = None, max_matches: int = 40) -> dict[str, Any]:
    engine = get_engine()
    out: dict[str, Any] = {}
    with engine.connect() as conn:
        targets = _season_ids(conn, seasons)
    if not targets:
        raise JobSkipped("musim tidak ditemukan")
    budget = int(max_matches)
    with UnderstatClient(engine=engine) as us:
        for season_id, label in targets:
            year = season_year(label)
            league = us.league_data(year)
            umatches = parse_matches(league)
            history = parse_team_history(league)
            endpoint = f"getLeagueData/EPL/{year}"
            with engine.begin() as conn:
                last = last_archived_at(conn, "understat", endpoint)
                if last is None or datetime.now(UTC) - last > LEAGUE_ARCHIVE_EVERY:
                    archive_payload(
                        conn,
                        source="understat",
                        endpoint=endpoint,
                        payload=league,
                        reason="backfill" if seasons else "daily",
                        season_label=label,
                        record_count=len(umatches),
                    )
                fixtures = conn.execute(
                    text(
                        """
                        select id, home_team_id, away_team_id, kickoff_utc, understat_match_id
                        from public.fixtures where season_id = :s
                        """
                    ),
                    {"s": season_id},
                ).all()
                team_map = match_teams(
                    umatches,
                    [
                        (int(f.home_team_id), int(f.away_team_id), f.kickoff_utc)
                        for f in fixtures
                        if f.kickoff_utc
                    ],
                )
                if team_map:
                    conn.execute(
                        text(
                            """
                            insert into public.team_external_ids (team_id, source, external_id)
                            values (:t, 'understat', :e) on conflict (source, external_id) do nothing
                            """
                        ),
                        [{"t": tid, "e": str(uid)} for uid, tid in team_map.items()],
                    )
                fx_list = [
                    (int(f.id), int(f.home_team_id), int(f.away_team_id), f.kickoff_utc) for f in fixtures
                ]
                fixture_of: dict[int, int] = {}
                for m in umatches:
                    fid = match_fixture(m, team_map, fx_list)
                    if fid is None:
                        continue
                    fixture_of[m.id] = fid
                linked = {int(f.id): f.understat_match_id for f in fixtures}
                fixture_updates = [{"u": u, "f": f} for u, f in fixture_of.items() if linked.get(f) != u]
                if fixture_updates:
                    conn.execute(
                        text("update public.fixtures set understat_match_id = :u where id = :f"),
                        fixture_updates,
                    )
                team_params: list[dict[str, Any]] = []
                for tm in history:
                    fid = _team_fixture(tm, team_map, fixtures)
                    if fid is None:
                        continue
                    team_params.append(
                        {
                            "f": fid,
                            "t": team_map[tm.team_id],
                            "xg": round(tm.xg, 3),
                            "xga": round(tm.xga, 3),
                            "ppda": tm.ppda,
                            "deep": tm.deep,
                            "extra": json.dumps(
                                {
                                    "npxg": round(tm.npxg, 3),
                                    "npxga": round(tm.npxga, 3),
                                    "ppda_allowed": tm.ppda_allowed,
                                    "deep_allowed": tm.deep_allowed,
                                    "scored": tm.scored,
                                    "missed": tm.missed,
                                }
                            ),
                        }
                    )
                if team_params:
                    conn.execute(
                        text(
                            """
                            insert into public.team_match_stats
                              (fixture_id, team_id, source, xg, xga, ppda, deep_completions, extra,
                               updated_at)
                            values (:f, :t, 'understat', :xg, :xga, :ppda, :deep,
                                    cast(:extra as jsonb), now())
                            on conflict (fixture_id, team_id, source) do update set
                              xg = excluded.xg, xga = excluded.xga, ppda = excluded.ppda,
                              deep_completions = excluded.deep_completions, extra = excluded.extra,
                              updated_at = now()
                            """
                        ),
                        team_params,
                    )
                team_rows = len(team_params)
                done = {
                    int(r.fixture_id)
                    for r in conn.execute(
                        text(
                            """
                            select distinct l.fixture_id from public.lineups l
                            join public.fixtures f on f.id = l.fixture_id
                            where l.source = 'understat' and f.season_id = :s
                            """
                        ),
                        {"s": season_id},
                    )
                }
                known = {
                    r.external_id: int(r.player_id)
                    for r in conn.execute(
                        text(
                            "select external_id, player_id from public.player_external_ids "
                            "where source = 'understat'"
                        )
                    )
                }
                season_players: dict[int, list[tuple[int, str, str]]] = defaultdict(list)
                for r in conn.execute(
                    text(
                        """
                        select ps.team_id, p.id, p.full_name, p.web_name from public.player_seasons ps
                        join public.players p on p.id = ps.player_id where ps.season_id = :s
                        """
                    ),
                    {"s": season_id},
                ):
                    season_players[int(r.team_id)].append((int(r.id), r.full_name, r.web_name))
            todo = [
                m for m in umatches if m.is_result and m.id in fixture_of and fixture_of[m.id] not in done
            ]
            todo.sort(key=lambda m: m.kickoff_utc)
            agg = {"matches": 0, "rosters": 0, "matched": 0, "unmatched": 0, "shots": 0}
            for m in todo[: max(0, budget)]:
                payload = us.match_data(m.id)
                with engine.begin() as conn:
                    archive_payload(
                        conn,
                        source="understat",
                        endpoint=f"getMatchData/{m.id}",
                        payload=payload,
                        reason="backfill" if seasons else "gw_final",
                        season_label=label,
                    )
                    st = _store_match(
                        conn, fixture_of[m.id], season_id, payload, m.id, team_map, known, season_players
                    )
                agg["matches"] += 1
                for k, v in st.items():
                    agg[k] += v
            budget -= agg["matches"]
            out[label] = {
                "teams_mapped": len(team_map),
                "fixtures_mapped": len(fixture_of),
                "team_match_rows": team_rows,
                "matches_pending": max(0, len(todo) - agg["matches"]),
                **agg,
            }
            log.info("understat.season", season=label, **out[label])
    # Snapshot selalu diambil (juga setelah backfill) agar profil taktik langsung tersedia di web.
    out["snapshot"] = snapshot_tactics()
    return out


def snapshot_tactics() -> dict[str, int]:
    """Snapshot point-in-time gaya tim & profil taktik pemain (permanen, untuk UI dan training ML)."""
    engine = get_engine()
    now = datetime.now(UTC)
    with engine.connect() as conn:
        styles = team_styles(conn, now)
        tactics = player_tactics(conn, now)
    with engine.begin() as conn:
        if styles:
            conn.execute(
                text(
                    """
                    insert into public.team_style_profiles (team_id, as_of, window_label, metrics, style_tags)
                    values (:t, :a, 'last19', cast(:m as jsonb), cast(:tags as jsonb))
                    on conflict (team_id, as_of, window_label) do nothing
                    """
                ),
                [
                    {
                        "t": s.team_id,
                        "a": now,
                        "m": json.dumps(
                            {
                                "matches": s.matches,
                                "ppda": round(s.ppda, 2),
                                "deep": round(s.deep, 2),
                                "deep_allowed": round(s.deep_allowed, 2),
                                "xg": round(s.xg, 3),
                                "xga": round(s.xga, 3),
                                "bucket": s.bucket,
                                "rank_passive": s.rank_passive,
                                "n_teams": s.n_teams,
                            }
                        ),
                        "tags": json.dumps(s.tags()),
                    }
                    for s in styles.values()
                ],
            )
        if tactics:
            conn.execute(
                text(
                    """
                    insert into public.player_form_features
                      (player_id, as_of, window_label, metrics, sample_minutes)
                    values (:p, :a, 'tactical', cast(:m as jsonb), :n)
                    on conflict (player_id, as_of, window_label) do nothing
                    """
                ),
                [
                    {"p": t.player_id, "a": now, "m": json.dumps(t.to_json()), "n": t.minutes}
                    for t in tactics.values()
                ],
            )
    return {"teams": len(styles), "players": len(tactics)}
