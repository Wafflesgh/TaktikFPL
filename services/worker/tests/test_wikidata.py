"""Parser Wikidata: pencarian klub & pelatih kepala (fixture respons asli)."""

import json
from datetime import date
from pathlib import Path

from app.jobs.sync_managers import close_superseded
from app.sources.wikidata import CoachTenure, current_tenures, parse_coaches, parse_search

FX = Path(__file__).parent / "fixtures" / "wikidata"


def load(name):
    return json.loads((FX / name).read_text(encoding="utf-8"))


def test_parse_search_returns_qids_in_order():
    assert parse_search(load("search.json"))[0] == "Q19490"
    assert parse_search({}) == []


def test_parse_coaches_and_current():
    rows = parse_coaches(load("coaches.json"))
    assert rows and all(r.club_qid == "Q18656" for r in rows)
    assert all(r.photo_url is None or r.photo_url.startswith("https://") for r in rows)
    cur = current_tenures(rows, date(2026, 10, 21))["Q18656"]
    assert cur.end is None and cur.start is not None
    assert all(r.start is None or r.start <= cur.start for r in rows if r.end is None)


def t(coach, start, end=None):
    return CoachTenure("Q1", coach, coach, start, end, None, None, None)


def test_close_superseded_closes_stale_open_tenure():
    out = close_superseded([t("B", date(2026, 1, 13)), t("A", date(2024, 7, 1))])
    a = next(x for x in out if x.coach_qid == "A")
    b = next(x for x in out if x.coach_qid == "B")
    assert a.end == date(2026, 1, 13) and b.end is None
    assert current_tenures(out, date(2026, 10, 1))["Q1"].coach_qid == "B"
