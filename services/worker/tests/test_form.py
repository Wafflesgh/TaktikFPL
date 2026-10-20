"""Form pemain: shrinkage, jendela, dan label (panas/bagus/stabil/menurun/dingin/minim_menit)."""

from app.features.form import (
    MatchLine,
    build_player_form,
    form_label,
    percentile,
    shrink,
    window_metrics,
)
from app.sources.fpl import parse_history


def line(i, minutes=90, pts=2, goals=0, assists=0, xg=0.1, xa=0.05, bonus=0, defcon=0, cs=0):
    return MatchLine(float(i), minutes, pts, goals, assists, bonus, xg, xa, defcon, cs)


def test_shrink_pulls_small_samples_to_prior():
    # 180 menit dengan 1.0 xGI/90 → ditarik kuat ke prior 0.3
    small = shrink(1.0, 180, 0.3)
    big = shrink(1.0, 2700, 0.3)
    assert 0.3 < small < big < 1.0
    assert shrink(1.0, 0, 0.3) == 0.3


def test_window_counts_bench_matches():
    ms = [line(i) for i in range(6)] + [line(6, minutes=0, pts=0), line(7, minutes=0, pts=0)]
    last4 = window_metrics(ms, 4)
    assert last4["matches"] == 4
    assert last4["appearances"] == 2
    assert last4["minutes_share"] == 0.5
    assert window_metrics(ms, None)["matches"] == 8


def test_percentile_midrank():
    assert percentile(5, [1, 5, 9]) == 0.5
    assert percentile(10, [1, 5, 9]) == 1.0
    assert percentile(0, []) == 0.5


def test_label_minim_menit():
    last4 = window_metrics([line(i, minutes=20) for i in range(4)], 4)
    assert form_label(last4, last4, 0.9, 0.9, "MID")["label"] == "minim_menit"


def _shrunk(ms, n):
    m = window_metrics(ms, n)
    for k in ("points90", "xgi90", "xg90", "xa90", "defcon90"):
        m[f"{k}_shrunk"] = m[k]
    return m


def test_label_hot_and_overperformance_flag():
    ms = [line(i, xg=0.2) for i in range(6)] + [
        line(6 + i, pts=12, goals=2, xg=0.5, xa=0.3) for i in range(4)
    ]
    v = form_label(_shrunk(ms, 4), _shrunk(ms, None), 0.95, 0.9, "FWD")
    assert v["label"] == "panas"
    assert any("overperform" in r for r in v["reasons"])


def test_label_declining_underlying():
    ms = [line(i, pts=6, xg=0.6, xa=0.2) for i in range(8)] + [line(8 + i, pts=2, xg=0.05) for i in range(4)]
    v = form_label(_shrunk(ms, 4), _shrunk(ms, None), 0.5, 0.2, "MID")
    assert v["label"] == "menurun"
    assert v["trend"] < -0.15


def test_label_cold_but_underlying_improving_is_stable():
    ms = [line(i, pts=1, xg=0.05) for i in range(8)] + [line(8 + i, pts=1, xg=0.5, xa=0.2) for i in range(4)]
    v = form_label(_shrunk(ms, 4), _shrunk(ms, None), 0.1, 0.4, "MID")
    assert v["label"] == "stabil"
    assert any("tren membaik" in r for r in v["reasons"])


def test_build_player_form_ranks_within_position():
    hot = [line(i, pts=10, goals=1, xg=0.7, xa=0.3) for i in range(8)]
    avg = [line(i, pts=3, xg=0.2, xa=0.1) for i in range(8)]
    cold = [line(i, pts=1, xg=0.02, xa=0.01) for i in range(8)]
    res = build_player_form({1: hot, 2: avg, 3: cold}, {1: "FWD", 2: "FWD", 3: "FWD"})
    assert set(res[1]) == {"last4", "last8", "season"}
    assert (
        res[1]["last4"]["pct_points_pos"]
        > res[2]["last4"]["pct_points_pos"]
        > res[3]["last4"]["pct_points_pos"]
    )
    assert res[1]["last4"]["form_label"] in {"panas", "bagus"}
    assert res[3]["last4"]["form_label"] == "dingin"


def test_parse_history_contract():
    import json
    from pathlib import Path

    payload = json.loads(
        (Path(__file__).parent / "fixtures/fpl/element-summary.json").read_text(encoding="utf-8")
    )
    for key in ("history", "fixtures", "history_past"):
        assert key in payload
    rows = parse_history(payload)
    assert rows and rows[0].round >= 1
    assert all(r.minutes >= 0 for r in rows)
    assert rows[-1].expected_goals is not None
