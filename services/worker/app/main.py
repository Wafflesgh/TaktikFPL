"""FastAPI app + lifespan: leader election → APScheduler."""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.api import admin, health
from app.config import get_settings
from app.db import get_engine

# Impor modul job agar terdaftar di runner.JOBS (endpoint admin & CLI).
from app.jobs import (  # noqa: F401
    backfill_history,
    build_form,
    cleanup_retention,
    deadline_checkpoint,
    evaluate_model,
    gw_finalize,
    model_lab,
    poll_event_status,
    run_projections,
    sync_bootstrap,
    sync_fixtures,
    sync_player_history,
    sync_understat,
)
from app.logging import configure_logging
from app.scheduler import registry
from app.scheduler.leader import SchedulerLeader

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.app_env)
    if settings.sentry_dsn:
        import sentry_sdk

        sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.app_env)

    leader = SchedulerLeader(
        get_engine(), registry.start, registry.stop, retry_seconds=settings.leader_retry_seconds
    )
    app.state.leader = leader
    task = asyncio.create_task(leader.run()) if settings.scheduler_enabled else None
    log.info("worker.started", env=settings.app_env, scheduler_enabled=settings.scheduler_enabled)
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        leader.release()
        get_engine().dispose()
        log.info("worker.stopped")


app = FastAPI(title="TaktikFPL Worker", version="0.1.0", lifespan=lifespan)
app.include_router(health.router)
app.include_router(admin.router)
