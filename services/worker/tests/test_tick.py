"""Penjadwalan tick (GitHub Actions): interval, H-1, checkpoint deadline, job harian."""

from datetime import UTC, datetime, timedelta

from app.tick import State, plan

NOW = datetime(2026, 10, 22, 10, 0, tzinfo=UTC)
CPS = [2880, 1440, 360, 120, 60, 15]


def state(last_ok=None, deadline=None, done=frozenset(), now=NOW):
    return State(
        now=now,
        last_ok=last_ok or {},
        next_gw=8 if deadline else None,
        next_deadline=deadline,
        done_checkpoints=set(done),
    )


def jobs(plans):
    return [p.job for p in plans]


def fresh(now=NOW, **ago_minutes):
    return {k: now - timedelta(minutes=v) for k, v in ago_minutes.items()}


def test_cold_start_runs_everything_due():
    out = jobs(plan(state(now=NOW.replace(hour=6)), CPS))
    for job in (
        "sync_bootstrap",
        "sync_fixtures",
        "poll_event_status",
        "cleanup_retention",
        "sync_player_history",
        "build_form",
    ):
        assert job in out


def test_intervals_respected():
    daily = fresh(
        cleanup_retention=60,
        sync_player_history=60,
        build_form=30,
        run_projections=20,
        evaluate_model=10,
        sync_understat=10,
        sync_managers=10,
        model_lab=10,
    )
    last = {**daily, **fresh(sync_bootstrap=14, sync_fixtures=14, poll_event_status=14, sync_news=5)}
    assert jobs(plan(state(last), CPS)) == ["sync_fixtures"]  # 14 + slack 3 ≥ 15


def test_bootstrap_every_tick_within_24h_of_deadline():
    last = fresh(
        sync_bootstrap=10,
        sync_fixtures=5,
        poll_event_status=5,
        cleanup_retention=60,
        sync_player_history=60,
        build_form=30,
        run_projections=20,
        evaluate_model=10,
    )
    far = plan(state(last, deadline=NOW + timedelta(hours=30)), CPS)
    near = plan(state(last, deadline=NOW + timedelta(hours=20)), CPS)
    assert "sync_bootstrap" not in jobs(far)
    assert "sync_bootstrap" in jobs(near)


def test_checkpoint_due_runs_once_and_replaces_syncs():
    deadline = NOW + timedelta(minutes=55)  # T-60 lewat 5 menit lalu
    out = plan(state({}, deadline=deadline), CPS)
    assert out[0].job == "deadline_checkpoint"
    assert out[0].kwargs == {"gw": 8, "minutes_before": 60}
    assert "sync_bootstrap" not in jobs(out) and "sync_fixtures" not in jobs(out)
    again = plan(state({}, deadline=deadline, done={60}), CPS)
    assert "deadline_checkpoint" not in jobs(again)


def test_missed_checkpoints_only_latest_runs():
    # Tick telat: T-120 dan T-60 sama-sama lewat → hanya T-60 (paling dekat deadline) yang jalan.
    deadline = NOW + timedelta(minutes=50)
    out = plan(state({}, deadline=deadline), [120, 60, 15])
    assert [p.kwargs for p in out if p.job == "deadline_checkpoint"] == [{"gw": 8, "minutes_before": 60}]


def test_stale_checkpoint_not_run():
    deadline = NOW + timedelta(minutes=60 - 50)  # T-60 lewat 50 menit (> grace 45) dan T-15 belum
    out = plan(state({}, deadline=deadline), [60])
    assert "deadline_checkpoint" not in jobs(out)


def test_daily_jobs_wait_for_hour_and_run_once_per_day():
    early = NOW.replace(hour=2)
    assert "cleanup_retention" not in jobs(plan(state(now=early), CPS))
    ran_today = fresh(now=NOW, cleanup_retention=60)
    assert "cleanup_retention" not in jobs(plan(state(ran_today), CPS))
    ran_yesterday = {"cleanup_retention": NOW - timedelta(days=1)}
    assert "cleanup_retention" in jobs(plan(state(ran_yesterday), CPS))


def test_build_form_follows_history():
    last = fresh(sync_player_history=60, build_form=120, cleanup_retention=60)
    assert "build_form" in jobs(plan(state(last), CPS))
    last = fresh(sync_player_history=120, build_form=60, cleanup_retention=60)
    assert "build_form" not in jobs(plan(state(last), CPS))


def test_projections_follow_form():
    last = fresh(cleanup_retention=60, sync_player_history=120, build_form=60, run_projections=90)
    assert "run_projections" in jobs(plan(state(last), CPS))
    last = fresh(cleanup_retention=60, sync_player_history=120, build_form=90, run_projections=60)
    assert "run_projections" not in jobs(plan(state(last), CPS))


def test_status_change_triggers_reprojection():
    from app.tick import Plan, followup

    st = state(fresh(run_projections=40))
    out = followup("sync_bootstrap", {"status_snapshots": 3}, [], st)
    assert out is not None and out.job == "run_projections"
    # tidak ada perubahan status → tidak proyeksi ulang
    assert followup("sync_bootstrap", {"status_snapshots": 0}, [], st) is None
    # proyeksi baru saja jalan → tunggu interval
    assert followup("sync_bootstrap", {"status_snapshots": 3}, [], state(fresh(run_projections=5))) is None
    # proyeksi sudah ada di antrean → tidak dobel
    queued = [Plan("run_projections", {}, "harian")]
    assert followup("sync_bootstrap", {"status_snapshots": 3}, queued, st) is None
