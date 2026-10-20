"""Deteksi perubahan jadwal (BLUEPRINT 9.2) + perhitungan checkpoint deadline."""

from datetime import UTC, datetime, timedelta

from app.jobs.sync_fixtures import FixtureSnapshot, detect_changes
from app.scheduler.registry import checkpoint_times

KO = datetime(2026, 10, 25, 14, 0, tzinfo=UTC)


def types(changes):
    return [c.change_type for c in changes]


def test_no_change():
    snap = FixtureSnapshot(9, KO, "scheduled")
    assert detect_changes(snap, snap) == []


def test_new_fixture_is_created():
    assert types(detect_changes(None, FixtureSnapshot(9, KO, "scheduled"))) == ["created"]


def test_kickoff_moved():
    old = FixtureSnapshot(9, KO, "scheduled")
    new = FixtureSnapshot(9, KO + timedelta(hours=26, minutes=30), "scheduled")
    changes = detect_changes(old, new)
    assert types(changes) == ["kickoff_moved"]
    assert changes[0].old_value == {"kickoff_utc": KO.isoformat()}
    assert changes[0].new_value == {"kickoff_utc": (KO + timedelta(hours=26, minutes=30)).isoformat()}


def test_gameweek_moved_with_kickoff():
    old = FixtureSnapshot(9, KO, "scheduled")
    new = FixtureSnapshot(12, KO + timedelta(days=21), "scheduled")
    assert types(detect_changes(old, new)) == ["gameweek_moved", "kickoff_moved"]


def test_postponed_when_event_becomes_null():
    old = FixtureSnapshot(9, KO, "scheduled")
    new = FixtureSnapshot(None, None, "postponed")
    # status postponed sudah tercakup oleh change 'postponed' → tidak dobel 'status_changed'
    assert types(detect_changes(old, new)) == ["postponed", "kickoff_moved"]


def test_rescheduled_from_blank():
    old = FixtureSnapshot(None, None, "postponed")
    new = FixtureSnapshot(33, KO + timedelta(days=150), "scheduled")
    assert types(detect_changes(old, new)) == ["rescheduled", "kickoff_moved", "status_changed"]


def test_normal_progress_not_recorded():
    assert detect_changes(FixtureSnapshot(9, KO, "scheduled"), FixtureSnapshot(9, KO, "live")) == []
    assert detect_changes(FixtureSnapshot(9, KO, "live"), FixtureSnapshot(9, KO, "finished")) == []


def test_tbc_to_scheduled_recorded():
    changes = detect_changes(FixtureSnapshot(9, None, "tbc"), FixtureSnapshot(9, KO, "scheduled"))
    assert types(changes) == ["kickoff_moved", "status_changed"]


def test_checkpoint_times_only_future():
    deadline = datetime(2026, 10, 24, 10, 0, tzinfo=UTC)
    now = deadline - timedelta(hours=5)
    times = checkpoint_times(deadline, [2880, 1440, 360, 120, 60, 15], now)
    assert sorted(times) == [15, 60, 120]
    assert times[60] == deadline - timedelta(minutes=60)
