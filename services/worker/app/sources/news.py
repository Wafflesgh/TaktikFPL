"""Adapter berita RSS (gratis): judul + ringkasan singkat + tautan; artikel penuh tidak disalin.

Feed dikonfigurasi lewat env NEWS_FEEDS ("kode|url,kode|url"). Pemain/klub dikenali dengan aturan nama
(bukan LLM), sinyal (cedera, skorsing, transfer, ...) dengan kata kunci — keduanya fungsi murni teruji.

Kebijakan arsip (CLAUDE.md aturan 9): news_items adalah fakta (tidak dihapus); respons RSS mentah disimpan
terpotong di raw_payloads dengan dedup 6 jam dari SourceClient.
"""

import html
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from time import struct_time
from typing import Any

import feedparser
import httpx
from sqlalchemy.engine import Engine

from app.sources.base import SourceClient

USER_AGENT = "TaktikFPL/0.1 (https://github.com/Wafflesgh/TaktikFPL; personal FPL analysis)"
SUMMARY_MAX = 320

DEFAULT_FEEDS = (
    "bbc|https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml,"
    "guardian|https://www.theguardian.com/football/premierleague/rss,"
    "sky|https://www.skysports.com/rss/11661,"
    "ffscout|https://www.fantasyfootballscout.co.uk/feed/"
)


class NewsClient(SourceClient):
    def __init__(self, engine: Engine | None = None, transport: httpx.BaseTransport | None = None):
        super().__init__(
            name="news_rss",
            base_url="https://localhost",  # setiap feed memakai URL absolut
            rps=1.0,
            engine=engine,
            headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml"},
            transport=transport,
        )

    def feed(self, url: str) -> str:
        return self.get_text(url)


def parse_feeds(raw: str) -> list[tuple[str, str]]:
    out = []
    for part in raw.split(","):
        code, _, url = part.strip().partition("|")
        if code and url.startswith("http"):
            out.append((code.strip(), url.strip()))
    return out


# --------------------------------------------------------------------------- parsing (murni)


@dataclass(frozen=True)
class NewsItem:
    source: str
    url: str
    title: str
    summary: str
    published_at: datetime | None


_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean(text: str, limit: int = SUMMARY_MAX) -> str:
    t = _WS.sub(" ", html.unescape(_TAG.sub(" ", text or ""))).strip()
    return t if len(t) <= limit else t[: limit - 1].rsplit(" ", 1)[0] + "…"


def _when(t: struct_time | None) -> datetime | None:
    return datetime(*t[:6], tzinfo=UTC) if t else None


def parse_feed(source: str, text: str) -> list[NewsItem]:
    d = feedparser.parse(text)
    out = []
    for e in d.entries:
        url = e.get("link")
        title = clean(e.get("title", ""), 300)
        if not url or not title:
            continue
        out.append(
            NewsItem(
                source=source,
                url=url.split("?")[0] if "bbc.co" in url else url,
                title=title,
                summary=clean(e.get("summary", "")),
                published_at=_when(e.get("published_parsed") or e.get("updated_parsed")),
            )
        )
    return out


SIGNALS: list[tuple[str, re.Pattern[str]]] = [
    ("suspension", re.compile(r"\b(suspen\w*|ban(ned)?|red card)\b", re.I)),
    (
        "return_to_training",
        re.compile(r"\b(back in training|return(s|ed)? to training|fit again|returns? from injury)\b", re.I),
    ),
    (
        "injury",
        re.compile(r"\b(injur\w*|hamstring|knock|ruled out|sidelined|fitness|surgery|out for)\b", re.I),
    ),
    (
        "manager_change",
        re.compile(r"\b(sacked|appointed|new (manager|head coach)|interim (manager|boss))\b", re.I),
    ),
    ("transfer", re.compile(r"\b(signs?|signed|signing|transfer|loan|joins?)\b", re.I)),
    ("lineup_leak", re.compile(r"\b(team news|line-?ups?|starting xi|press conference)\b", re.I)),
]


def signal_of(text: str) -> str:
    for name, pat in SIGNALS:
        if pat.search(text):
            return name
    return "other"


@dataclass(frozen=True)
class Candidate:
    id: int
    names: tuple[str, ...]  # nama lengkap + web_name (bila unik)


def candidates(players: list[tuple[int, str, str]]) -> list[Candidate]:
    """(id, web_name, full_name) → kandidat; web_name dipakai hanya bila unik & ≥ 4 huruf."""
    count: dict[str, int] = {}
    for _, web, _ in players:
        count[web.lower()] = count.get(web.lower(), 0) + 1
    out = []
    for pid, web, full in players:
        names = [full] if full and " " in full else []
        if len(web) >= 4 and count[web.lower()] == 1:
            names.append(web)
        if names:
            out.append(Candidate(pid, tuple(names)))
    return out


def match_names(text: str, cands: list[Candidate]) -> list[int]:
    """Id yang namanya muncul sebagai kata utuh, huruf besar persis (menghindari 'rice', 'white', ...)."""
    hits = []
    for c in cands:
        if any(re.search(rf"(?<![\w-]){re.escape(n)}(?![\w-])", text) for n in c.names):
            hits.append(c.id)
    return hits


def item_text(i: NewsItem | Any) -> str:
    return f"{i.title}. {i.summary}"
