"""Tick: dijalankan GitHub Actions tiap ±15 menit — menentukan job yang jatuh tempo lalu menjalankannya.

Pengganti scheduler always-on (docs/adr/0002-worker-github-actions.md). Status "kapan terakhir
jalan" dibaca dari job_runs, jadi tick tidak butuh penyimpanan sendiri dan tahan terhadap jadwal
GitHub yang kadang telat. Tidak ada dua tick bersamaan (concurrency group di workflow).

    uv run python -m app.tick            # jalankan job yang jatuh tempo
    uv run python -m app.tick --dry-run  # hanya tampilkan rencana
"""

import argparse
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine
from app.jobs import (
    build_form,
    cleanup_retention,
    deadline_checkpoint,
    evaluate_model,
    poll_event_status,
    run_projections,
    sync_bootstrap,
    sync_fixtures,
    sync_player_history,
    sync_understat,
)
from app.logging import configure_logging

# Interval minimum antar run sukses (BLUEPRINT 9.1, disesuaikan dengan tick 15 menit).
INTERVALS = {
    "sync_bootstrap": timedelta(minutes=30),
    "sync_fixtures": timedelta(minutes=15),
    "poll_event_status": timedelta(minutes=30),
}
# Toleransi agar tick yang datang sedikit lebih awal dari interval tetap menjalankan job.
SLACK = timedelta(minutes=3)
# sync_understat sebelum proyeksi harian (data taktik) — Understat diperbarui beberapa jam setelah laga.
DAILY_AFTER_UTC = {"cleanup_retention": 3, "sync_player_history": 5, "sync_understat": 6, "evaluate_model": 7}
# Checkpoint deadline yang terlewat lebih dari ini dianggap basi (tidak dijalankan lagi).
CHECKPOINT_GRACE = timedelta(minutes=45)
# Status/berita pemain berubah -> proyeksi dihitung ulang, paling sering sekali per interval ini.
REPROJECT_MIN = timedelta(minutes=30)


@dataclass(frozen=True)
class State:
    now: datetime
    last_ok: dict[str, datetime]  # job_name → finished_at run sukses terakhir
    next_gw: int | None
    next_deadline: datetime | None
    done_checkpoints: set[int]  # menit-sebelum-deadline yang sudah jalan untuk next_gw


@dataclass(frozen=True)
class Plan:
    job: str
    kwargs: dict[str, Any]
    reason: str


def _since(state: State, job: str) -> timedelta | None:
    last = state.last_ok.get(job)
    return None if last is None else state.now - last


def plan(state: State, checkpoints_min: list[int]) -> list[Plan]:
    """Fungsi murni: daftar job yang harus jalan sekarang, berurutan."""
    out: list[Plan] = []
    now = state.now
    h1 = state.next_deadline is not None and timedelta(0) < state.next_deadline - now <= timedelta(hours=24)

    # Checkpoint deadline: jalankan yang paling dekat ke deadline di antara yang sudah lewat waktunya.
    due_cp: list[int] = []
    if state.next_deadline is not None and state.next_gw is not None:
        for m in checkpoints_min:
            run_at = state.next_deadline - timedelta(minutes=m)
            if run_at <= now < run_at + CHECKPOINT_GRACE and m not in state.done_checkpoints:
                due_cp.append(m)
    if due_cp:
        m = min(due_cp)
        # Checkpoint sudah mencakup sync_bootstrap + sync_fixtures (dengan arsip 'deadline').
        out.append(Plan("deadline_checkpoint", {"gw": state.next_gw, "minutes_before": m}, f"T-{m}m"))
    else:
        for job, every in INTERVALS.items():
            if job == "poll_event_status":
                continue
            interval = timedelta(minutes=5) if (job == "sync_bootstrap" and h1) else every
            since = _since(state, job)
            if since is None or since + SLACK >= interval:
                out.append(Plan(job, {}, "H-1 deadline" if h1 and job == "sync_bootstrap" else "interval"))

    since = _since(state, "poll_event_status")
    if since is None or since + SLACK >= INTERVALS["poll_event_status"]:
        out.append(Plan("poll_event_status", {}, "interval"))

    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for job, hour in DAILY_AFTER_UTC.items():
        last = state.last_ok.get(job)
        if now.hour >= hour and (last is None or last < today):
            out.append(Plan(job, {}, f"harian ≥{hour:02d}:00 UTC"))
    # build_form setelah riwayat pemain diperbarui
    hist, form = state.last_ok.get("sync_player_history"), state.last_ok.get("build_form")
    history_planned = any(p.job == "sync_player_history" for p in out)
    form_planned = history_planned or (hist is not None and (form is None or form < hist))
    if form_planned:
        out.append(Plan("build_form", {}, "setelah sync_player_history"))
    # Proyeksi: setelah form diperbarui, atau bila belum ada proyeksi hari ini.
    proj = state.last_ok.get("run_projections")
    if form_planned or proj is None or proj < today or (form is not None and proj < form):
        out.append(Plan("run_projections", {}, "setelah build_form / harian"))
    return out


def followup(done: str, result: dict[str, Any] | None, todo: list[Plan], state: State) -> Plan | None:
    """Job tambahan berdasarkan hasil job yang baru selesai (fungsi murni).

    sync_bootstrap menemukan status/berita cedera baru -> run_projections ulang supaya
    rekomendasi langsung memperhitungkan pemain yang diragukan/absen.
    """
    if done != "sync_bootstrap" or not result or not result.get("status_snapshots"):
        return None
    if any(p.job == "run_projections" for p in todo):
        return None  # proyeksi memang akan jalan di tick ini
    since = _since(state, "run_projections")
    if since is not None and since + SLACK < REPROJECT_MIN:
        return None
    return Plan("run_projections", {}, f"status pemain berubah ({result['status_snapshots']})")


def load_state(now: datetime) -> State:
    with get_engine().connect() as conn:
        last_ok = {
            r.job_name: r.finished_at
            for r in conn.execute(
                text(
                    """
                    select job_name, max(finished_at) as finished_at
                    from public.job_runs where status = 'ok'
                    group by job_name
                    """
                )
            )
        }
        nxt = conn.execute(
            text(
                """
                select g.number, g.deadline_utc from public.gameweeks g
                join public.seasons s on s.id = g.season_id and s.is_current
                where g.is_next
                """
            )
        ).first()
        done: set[int] = set()
        if nxt is not None:
            done = {
                int(r.m)
                for r in conn.execute(
                    text(
                        """
                        select (stats ->> 'minutes_before')::int as m from public.job_runs
                        where job_name = 'deadline_checkpoint' and status = 'ok'
                          and (stats ->> 'gw')::int = :gw
                        """
                    ),
                    {"gw": nxt.number},
                )
            }
    return State(
        now=now,
        last_ok=last_ok,
        next_gw=int(nxt.number) if nxt else None,
        next_deadline=nxt.deadline_utc if nxt else None,
        done_checkpoints=done,
    )


JOBS: dict[str, Callable[..., Any]] = {
    "sync_bootstrap": sync_bootstrap.sync_bootstrap,
    "sync_fixtures": sync_fixtures.sync_fixtures,
    "poll_event_status": poll_event_status.poll_event_status,
    "sync_player_history": sync_player_history.sync_player_history,
    "build_form": build_form.build_form,
    "cleanup_retention": cleanup_retention.cleanup_retention,
    "deadline_checkpoint": deadline_checkpoint.deadline_checkpoint,
    "run_projections": run_projections.run_projections,
    "evaluate_model": evaluate_model.evaluate_model,
    "sync_understat": sync_understat.sync_understat,
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.tick")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    settings = get_settings()
    configure_logging(settings.app_env)

    state = load_state(datetime.now(UTC))
    todo = plan(state, settings.checkpoints_min)
    print(json.dumps({"now": state.now.isoformat(), "plan": [p.__dict__ for p in todo]}, default=str))
    if args.dry_run:
        return 0
    failed = 0
    queue = list(todo)
    while queue:
        p = queue.pop(0)
        try:
            result = JOBS[p.job](**p.kwargs)
        except Exception:  # sudah tercatat di job_runs; lanjutkan job lain
            failed += 1
            continue
        extra = followup(p.job, result, queue, state)
        if extra is not None:
            print(json.dumps({"followup": extra.__dict__}, default=str))
            queue.append(extra)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
