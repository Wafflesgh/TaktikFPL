"""Adapter Wikidata (gratis, CC0): klub → pelatih kepala (P286) beserta masa jabatan & foto.

- Pencarian klub: CirrusSearch `haswbstatement:P31=Q476028` (klub sepak bola) — nama klub tidak
  di-hardcode; nama dari Understat/FPL dicari, hasil divalidasi tipe entitasnya.
- Pelatih: satu query SPARQL untuk semua klub (pernyataan P286 + kualifikasi mulai/selesai).

Kebijakan arsip (CLAUDE.md aturan 9): hasil SPARQL diarsip sekali per sinkron (kecil, berubah jarang);
raw_payloads menyimpan respons dengan dedup 6 jam dari SourceClient.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx
from sqlalchemy.engine import Engine

from app.sources.base import SourceClient

USER_AGENT = "TaktikFPL/0.1 (https://github.com/Wafflesgh/TaktikFPL; personal FPL analysis)"
SPARQL_URL = "https://query.wikidata.org/sparql"
FOOTBALL_CLUB = "Q476028"
ENTITY = "http://www.wikidata.org/entity/"

COACHES_QUERY = """
SELECT ?club ?coach ?coachLabel ?start ?end ?img ?birth ?natLabel WHERE {
  VALUES ?club { %s }
  ?club p:P286 ?st . ?st ps:P286 ?coach .
  OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?coach wdt:P18 ?img } OPTIONAL { ?coach wdt:P569 ?birth }
  OPTIONAL { ?coach wdt:P27 ?nat }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""


class WikidataClient(SourceClient):
    def __init__(
        self,
        base_url: str = "https://www.wikidata.org/",
        rps: float = 1.0,
        engine: Engine | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        super().__init__(
            name="wikidata",
            base_url=base_url,
            rps=rps,
            engine=engine,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            transport=transport,
        )

    def search_club(self, name: str) -> dict[str, Any]:
        return self.get_json(
            "w/api.php",
            {
                "action": "query",
                "list": "search",
                "srsearch": f"{name} haswbstatement:P31={FOOTBALL_CLUB}",
                "srlimit": 5,
                "format": "json",
            },
        )

    def sitelinks(self, qids: list[str]) -> dict[str, Any]:
        return self.get_json(
            "w/api.php",
            {"action": "wbgetentities", "ids": "|".join(qids[:50]), "props": "sitelinks", "format": "json"},
        )

    def coaches(self, club_qids: list[str]) -> dict[str, Any]:
        values = " ".join(f"wd:{q}" for q in club_qids)
        return self.get_json(SPARQL_URL, {"query": COACHES_QUERY % values, "format": "json"})


# --------------------------------------------------------------------------- parsing (murni)


@dataclass(frozen=True)
class CoachTenure:
    club_qid: str
    coach_qid: str
    name: str
    start: date | None
    end: date | None
    photo_url: str | None
    birth_date: date | None
    nationality: str | None


def parse_search(payload: dict[str, Any]) -> list[str]:
    """QID hasil pencarian, urut relevansi."""
    return [h["title"] for h in (payload.get("query") or {}).get("search") or [] if "title" in h]


def parse_sitelinks(payload: dict[str, Any]) -> dict[str, int]:
    """QID → jumlah artikel Wikipedia (sitelinks)."""
    return {q: len(e.get("sitelinks") or {}) for q, e in (payload.get("entities") or {}).items()}


def pick_club(hits: list[str], sitelinks: dict[str, int]) -> str | None:
    """Klub utama = kandidat dengan sitelinks terbanyak (tim akademi/wanita/cadangan jauh lebih sedikit);
    seri → urutan relevansi pencarian."""
    if not hits:
        return None
    return max(hits, key=lambda q: (sitelinks.get(q, 0), -hits.index(q)))


def _qid(uri: str) -> str:
    return uri.removeprefix(ENTITY)


def _date(v: dict[str, str] | None) -> date | None:
    if not v or not v.get("value"):
        return None
    try:
        return date.fromisoformat(v["value"][:10])
    except ValueError:
        return None


def parse_coaches(payload: dict[str, Any]) -> list[CoachTenure]:
    """Satu baris per (klub, pelatih, mulai); kewarganegaraan ganda → baris pertama dipakai."""
    seen: dict[tuple[str, str, date | None], CoachTenure] = {}
    for b in (payload.get("results") or {}).get("bindings") or []:
        club, coach = _qid(b["club"]["value"]), _qid(b["coach"]["value"])
        start = _date(b.get("start"))
        key = (club, coach, start)
        if key in seen:
            continue
        img = (b.get("img") or {}).get("value")
        seen[key] = CoachTenure(
            club_qid=club,
            coach_qid=coach,
            name=(b.get("coachLabel") or {}).get("value") or coach,
            start=start,
            end=_date(b.get("end")),
            # Special:FilePath + width → thumbnail kecil dari CDN Wikimedia.
            photo_url=f"{img.replace('http://', 'https://')}?width=160" if img else None,
            birth_date=_date(b.get("birth")),
            nationality=(b.get("natLabel") or {}).get("value"),
        )
    return list(seen.values())


def current_tenures(tenures: list[CoachTenure], today: date) -> dict[str, CoachTenure]:
    """Klub → pelatih aktif: mulai paling akhir (≤ hari ini) yang belum berakhir."""
    out: dict[str, CoachTenure] = {}
    for t in tenures:
        if t.start is None or t.start > today or (t.end is not None and t.end <= today):
            continue
        cur = out.get(t.club_qid)
        if cur is None or (cur.start is not None and t.start > cur.start):
            out[t.club_qid] = t
    return out
