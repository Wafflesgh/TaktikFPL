"""Leader election via advisory lock — diuji dengan engine palsu (tanpa DB)."""

import asyncio

import pytest

from app.scheduler.leader import SchedulerLeader


class FakeConn:
    def __init__(self, lock_result: bool, fail_heartbeat: bool = False):
        self.lock_result = lock_result
        self.fail_heartbeat = fail_heartbeat
        self.closed = False

    def execute(self, stmt):
        sql = str(stmt)
        if "pg_try_advisory_lock" in sql:
            return FakeResult(self.lock_result)
        if self.fail_heartbeat:
            raise ConnectionError("koneksi putus")
        return FakeResult(1)

    def commit(self):
        pass

    def close(self):
        self.closed = True


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value


class FakeEngine:
    def __init__(self, conns):
        self.conns = list(conns)
        self.opened = []

    def connect(self):
        conn = self.conns.pop(0)
        self.opened.append(conn)
        return conn


class Recorder:
    def __init__(self):
        self.events = []

    def start(self):
        self.events.append("start")

    def stop(self):
        self.events.append("stop")


async def run_ticks(leader, ticks):
    task = asyncio.create_task(leader.run())
    await asyncio.sleep(0.05 * ticks)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_acquires_lock_and_starts_scheduler():
    rec = Recorder()
    engine = FakeEngine([FakeConn(True)])
    leader = SchedulerLeader(engine, rec.start, rec.stop, retry_seconds=0.01)
    await run_ticks(leader, 2)
    assert leader.is_leader
    assert rec.events == ["start"]
    leader.release()
    assert rec.events == ["start", "stop"]
    assert engine.opened[0].closed  # menutup koneksi melepas advisory lock


async def test_standby_when_lock_taken():
    rec = Recorder()
    engine = FakeEngine([FakeConn(False) for _ in range(50)])
    leader = SchedulerLeader(engine, rec.start, rec.stop, retry_seconds=0.01)
    await run_ticks(leader, 2)
    assert not leader.is_leader
    assert rec.events == []
    assert all(c.closed for c in engine.opened)


async def test_standby_takes_over_when_lock_released():
    rec = Recorder()
    engine = FakeEngine([FakeConn(False), FakeConn(False), FakeConn(True)])
    leader = SchedulerLeader(engine, rec.start, rec.stop, retry_seconds=0.01)
    await run_ticks(leader, 4)
    assert leader.is_leader
    assert rec.events == ["start"]


async def test_heartbeat_failure_releases_and_stops():
    rec = Recorder()
    first = FakeConn(True, fail_heartbeat=True)
    engine = FakeEngine([first] + [FakeConn(False) for _ in range(50)])
    leader = SchedulerLeader(engine, rec.start, rec.stop, retry_seconds=0.01)
    await run_ticks(leader, 4)
    assert rec.events[:2] == ["start", "stop"]
    assert first.closed
    assert not leader.is_leader
