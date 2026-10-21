"""Alasan pemilihan pemain — template deterministik dari angka engine (bukan LLM).

Setiap alasan: {"kind", "tone", "text"}. kind ∈ availability | dgw | fixture | form | run | minutes;
tone ∈ good | warn | bad. Teks UI dalam bahasa Inggris (CLAUDE.md aturan 7).
"""

from dataclasses import dataclass
from typing import Any

UNAVAILABLE = {"i", "s", "u", "n"}
# Kemudahan laga: penyerang memakai pengali serangan (vs laga rata-rata timnya sendiri),
# bek/kiper memakai peluang clean sheet tim.
ATT_EASY, ATT_TOUGH = 1.15, 0.85
CS_EASY, CS_TOUGH = 0.40, 0.20
NAILED_MINS, ROTATION_MINS = 80.0, 55.0
RUN_LENGTH = 5
MAX_REASONS = 4

FORM_TEXT = {
    "panas": ("good", "Hot form"),
    "bagus": ("good", "Good form"),
    "menurun": ("warn", "Form dipping"),
    "dingin": ("warn", "Cold form"),
}


@dataclass(frozen=True)
class FixtureView:
    gw: int
    opp: str
    home: bool
    xmins: float
    att_mult: float
    team_cs: float


def _label(f: FixtureView) -> str:
    return f"{f.opp} ({'H' if f.home else 'A'})"


def ease(position: str, f: FixtureView) -> int:
    """+1 laga mudah, -1 laga sulit, 0 biasa — dari sudut pandang posisi pemain."""
    if position in ("GKP", "DEF"):
        return 1 if f.team_cs >= CS_EASY else -1 if f.team_cs <= CS_TOUGH else 0
    return 1 if f.att_mult >= ATT_EASY else -1 if f.att_mult <= ATT_TOUGH else 0


def _fixture_text(position: str, f: FixtureView) -> str:
    if position in ("GKP", "DEF"):
        return f"{round(f.team_cs * 100)}% clean-sheet chance vs {_label(f)}"
    pct = round((f.att_mult - 1) * 100)
    return f"vs {_label(f)}: team attack {pct:+d}% vs their usual"


def player_reasons(
    position: str,
    status: str | None,
    chance_next: int | None,
    news: str | None,
    form: dict[str, Any] | None,
    fixtures: list[FixtureView],
    first_gw: int,
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []

    def add(kind: str, tone: str, text: str) -> None:
        out.append({"kind": kind, "tone": tone, "text": text})

    short_news = (news or "").strip()
    short_news = short_news if len(short_news) <= 60 else short_news[:57] + "..."
    if status in UNAVAILABLE:
        add("availability", "bad", f"Out: {short_news or 'unavailable'}")
    elif chance_next is not None and chance_next < 100:
        add(
            "availability",
            "warn",
            f"Doubt: {chance_next}% to play" + (f" ({short_news})" if short_news else ""),
        )

    now = [f for f in fixtures if f.gw == first_gw]
    later = sorted((f for f in fixtures if f.gw > first_gw), key=lambda f: f.gw)[:RUN_LENGTH]
    if len(now) >= 2:
        add("dgw", "good", f"Double gameweek: {' + '.join(_label(f) for f in now)}")
    elif not now:
        add("dgw", "bad", f"No fixture in GW{first_gw}")

    now_ease = [ease(position, f) for f in now]
    if now and max(now_ease) == 1:
        add("fixture", "good", "Easy fixture: " + _fixture_text(position, now[now_ease.index(1)]))
    elif now and min(now_ease) == -1 and len(now) == 1:
        add("fixture", "warn", "Tough fixture: " + _fixture_text(position, now[0]))

    if form:
        label = form.get("form_label")
        ppm = form.get("points_per_match")
        if label in FORM_TEXT:
            tone, head = FORM_TEXT[label]
            add("form", tone, f"{head}: {float(ppm or 0):.1f} pts/match in last 4")
        elif label == "minim_menit":
            add("form", "warn", "Few minutes in the last 4 matches")
        pct = form.get("pct_underlying_pos")
        if label not in ("dingin", "minim_menit") and pct is not None and float(pct) >= 0.8:
            add(
                "form",
                "good",
                f"Underlying stats in top {max(1, round((1 - float(pct)) * 100))}% of {position}s",
            )

    if later:
        easy = [f for f in later if ease(position, f) == 1]
        if len(easy) >= 3:
            prefix = "Easier run after this GW" if now and min(now_ease) == -1 else "Good run"
            names = ", ".join(_label(f) for f in easy[:3])
            add("run", "good", f"{prefix}: {len(easy)} of next {len(later)} favourable ({names})")
        elif sum(1 for f in later if ease(position, f) == -1) >= 3:
            add("run", "warn", f"Tough run: 3+ of next {len(later)} fixtures are hard")

    if now and status not in UNAVAILABLE:
        mins = max(f.xmins for f in now)
        if mins >= NAILED_MINS:
            add("minutes", "good", f"Nailed: ~{round(mins)} mins expected")
        elif 0 < mins < ROTATION_MINS:
            add("minutes", "warn", f"Rotation risk: ~{round(mins)} mins expected")

    # Peringatan (bad/warn ketersediaan) selalu ditampilkan; sisanya urut sesuai prioritas di atas.
    return out[:MAX_REASONS]
