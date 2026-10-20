"""Definisi job statis + checkpoint deadline dinamis.

Hanya proses leader (lihat leader.py) yang menjalankan scheduler. Job disimpan di
schema `scheduler` (SQLAlchemyJobStore) sehingga job `date` dinamis bertahan saat redeploy.
"""

from datetime import UTC, datetime, timedelta

import structlog
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine

log = structlog.get_logger()

_scheduler: AsyncIOScheduler | None = None

# Referensi tekstual "modul:fungsi" agar bisa disimpan di jobstore persisten.
STATIC_JOBS = (
    ("sync_bootstrap", "app.jobs.sync_bootstrap:sync_bootstrap", IntervalTrigger(minutes=30)),
    ("sync_fixtures", "app.jobs.sync_fixtures:sync_fixtures", IntervalTrigger(minutes=15)),
    ("poll_event_status", "app.jobs.poll_event_status:poll_event_status", IntervalTrigger(minutes=10)),
    (
        "sync_player_history",
        "app.jobs.sync_player_history:sync_player_history",
        CronTrigger(hour=5, minute=0),
    ),
    ("build_form", "app.jobs.build_form:build_form", CronTrigger(hour=6, minute=0)),
    ("cleanup_retention", "app.jobs.cleanup_retention:cleanup_retention", CronTrigger(hour=3, minute=0)),
)


def build_scheduler() -> AsyncIOScheduler:
    jobstore = SQLAlchemyJobStore(engine=get_engine(), tablename="apscheduler_jobs", tableschema="scheduler")
    scheduler = AsyncIOScheduler(
        jobstores={"default": jobstore},
        timezone=UTC,
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 600},
    )
    for job_id, func, trigger in STATIC_JOBS:
        scheduler.add_job(func, trigger, id=job_id, name=job_id, replace_existing=True)
    return scheduler


def start() -> None:
    """Dipanggil SchedulerLeader saat proses ini menjadi leader (di event loop)."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = build_scheduler()
    _scheduler.start()
    log.info("scheduler.started", jobs=[j.id for j in _scheduler.get_jobs()])
    try:
        ensure_deadline_checkpoints()
    except Exception as exc:  # DB belum berisi gameweeks (sebelum sync_bootstrap pertama)
        log.warning("scheduler.checkpoints_not_scheduled", error=str(exc))


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        log.info("scheduler.stopped")


def is_running() -> bool:
    return _scheduler is not None and _scheduler.running


def ensure_deadline_checkpoints() -> None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                """
                select g.number, g.deadline_utc
                from public.gameweeks g
                join public.seasons s on s.id = g.season_id and s.is_current
                where g.is_next
                """
            )
        ).first()
    if row is not None:
        reschedule_deadline_checkpoints(int(row.number), row.deadline_utc)


def checkpoint_times(
    deadline_utc: datetime, checkpoints_min: list[int], now: datetime
) -> dict[int, datetime]:
    """Menit-sebelum-deadline → waktu jalan (UTC), hanya yang masih di masa depan."""
    out = {}
    for minutes in checkpoints_min:
        run_at = deadline_utc - timedelta(minutes=minutes)
        if run_at > now:
            out[minutes] = run_at
    return out


def reschedule_deadline_checkpoints(gw: int, deadline_utc: datetime) -> list[str]:
    """Buat (ulang) job `date` untuk setiap checkpoint + sync_bootstrap tiap 5 menit di H-1."""
    if _scheduler is None:
        log.info("scheduler.reschedule_skipped_not_leader", gw=gw)
        return []
    now = datetime.now(UTC)
    settings = get_settings()

    # Hapus checkpoint lama (GW mana pun) supaya deadline yang dimajukan tidak meninggalkan job basi.
    for existing in _scheduler.get_jobs():
        if existing.id.startswith("deadline_gw") or existing.id == "sync_bootstrap_h1":
            existing.remove()

    created = []
    for minutes, run_at in checkpoint_times(deadline_utc, settings.checkpoints_min, now).items():
        job_id = f"deadline_gw{gw}_t{minutes}"
        _scheduler.add_job(
            "app.jobs.deadline_checkpoint:deadline_checkpoint",
            DateTrigger(run_date=run_at),
            id=job_id,
            name=job_id,
            kwargs={"gw": gw, "minutes_before": minutes},
            replace_existing=True,
        )
        created.append(job_id)

    fast_start = max(now, deadline_utc - timedelta(hours=24))
    if fast_start < deadline_utc:
        _scheduler.add_job(
            "app.jobs.sync_bootstrap:sync_bootstrap",
            IntervalTrigger(minutes=5, start_date=fast_start, end_date=deadline_utc),
            id="sync_bootstrap_h1",
            name="sync_bootstrap_h1",
            replace_existing=True,
        )
        created.append("sync_bootstrap_h1")
    log.info("scheduler.deadline_checkpoints", gw=gw, deadline=deadline_utc.isoformat(), jobs=created)
    return created
