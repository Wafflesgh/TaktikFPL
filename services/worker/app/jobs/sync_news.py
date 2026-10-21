"""sync_news: berita RSS → news_items (+ news_entities: pemain/klub & sinyal dari aturan, bukan LLM).

Berjalan tiap tick (±15 menit). Item baru langsung terkirim ke browser lewat Supabase Realtime.
"""

from typing import Any

import structlog
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine
from app.scheduler.runner import job
from app.sources.base import SourceHTTPError
from app.sources.news import (
    DEFAULT_FEEDS,
    NewsClient,
    candidates,
    item_text,
    match_names,
    parse_feed,
    parse_feeds,
    signal_of,
)

log = structlog.get_logger()


@job("sync_news")
def sync_news() -> dict[str, Any]:
    engine = get_engine()
    feeds = parse_feeds(get_settings().news_feeds or DEFAULT_FEEDS)
    with engine.connect() as conn:
        players = conn.execute(
            text(
                """
                select p.id, p.web_name, p.full_name, ps.team_id
                from public.players p
                join public.player_seasons ps on ps.player_id = p.id
                join public.seasons s on s.id = ps.season_id and s.is_current
                """
            )
        ).all()
        teams = conn.execute(
            text(
                """
                select t.id, t.name from public.teams t
                join public.team_seasons ts on ts.team_id = t.id
                join public.seasons s on s.id = ts.season_id and s.is_current
                """
            )
        ).all()
    pcands = candidates([(int(p.id), p.web_name, p.full_name) for p in players])
    team_of_player = {int(p.id): int(p.team_id) for p in players}
    tcands = candidates([(int(t.id), t.name, t.name) for t in teams])

    items, failed = [], []
    with NewsClient(engine=engine) as nc:
        for code, url in feeds:
            try:
                items.extend(parse_feed(code, nc.feed(url)))
            except (SourceHTTPError, OSError) as exc:  # satu feed gagal tidak menghentikan yang lain
                failed.append(code)
                log.warning("sync_news.feed_failed", feed=code, error=str(exc))

    new = 0
    with engine.begin() as conn:
        for it in items:
            nid = conn.execute(
                text(
                    """
                    insert into public.news_items (url, source, title, published_at, raw_text, lang)
                    values (:u, :s, :t, :p, :r, 'en')
                    on conflict (url) do nothing returning id
                    """
                ),
                {"u": it.url, "s": it.source, "t": it.title, "p": it.published_at, "r": it.summary},
            ).scalar()
            if nid is None:
                continue
            new += 1
            body = item_text(it)
            signal = signal_of(body)
            pids = match_names(body, pcands)
            tids = set(match_names(body, tcands)) - {team_of_player[p] for p in pids if p in team_of_player}
            rows = [{"n": nid, "p": p, "t": team_of_player.get(p), "sig": signal} for p in pids]
            rows += [{"n": nid, "p": None, "t": t, "sig": signal} for t in tids]
            if rows:
                conn.execute(
                    text(
                        """
                        insert into public.news_entities
                          (news_id, player_id, team_id, signal_type, extracted_by)
                        values (:n, :p, :t, :sig, 'rules')
                        """
                    ),
                    rows,
                )
    return {"feeds": len(feeds), "failed": failed, "fetched": len(items), "new": new}
