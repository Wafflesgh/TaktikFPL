"""Parser RSS + pengenalan pemain & sinyal berita (aturan, bukan LLM)."""

from pathlib import Path

from app.sources.news import (
    NewsItem,
    candidates,
    clean,
    match_names,
    parse_feed,
    parse_feeds,
    signal_of,
)

FX = Path(__file__).parent / "fixtures" / "news"


def test_parse_feed_bbc():
    items = parse_feed("bbc", (FX / "bbc.xml").read_text(encoding="utf-8"))
    assert len(items) == 2  # item tanpa tautan dilewati
    assert items[0].summary.startswith("The club confirmed the striker will miss")
    assert items[0].published_at is not None and items[0].published_at.hour == 6
    assert signal_of(items[0].title) == "injury" and signal_of(items[1].title) == "return_to_training"


def test_parse_feeds_config():
    assert parse_feeds("a|https://x/rss, bad, b|http://y") == [("a", "https://x/rss"), ("b", "http://y")]


def test_clean_strips_html_and_truncates():
    assert clean("<p>Hello &amp; <b>bye</b></p>") == "Hello & bye"
    assert clean("word " * 100, 20).endswith("…")


def test_signal_rules():
    assert signal_of("Saka ruled out for three weeks with hamstring injury") == "injury"
    assert signal_of("Rice handed three-match ban after red card") == "suspension"
    assert signal_of("Palmer back in training ahead of derby") == "return_to_training"
    assert signal_of("Arsenal beat Spurs 2-0") == "other"


def test_match_names_needs_unique_capitalised_names():
    cands = candidates(
        [
            (1, "Rice", "Declan Rice"),
            (2, "Gabriel", "Gabriel Magalhães"),
            (3, "Gabriel", "Gabriel Jesus"),
            (4, "Saka", "Bukayo Saka"),
        ]
    )
    text = "Saka and Gabriel Jesus start; rice and beans for lunch. Gabriel injured."
    assert set(match_names(text, cands)) == {3, 4}
    assert match_names(NewsItem("x", "u", "Rice signs", "", None).title, cands) == [1]
