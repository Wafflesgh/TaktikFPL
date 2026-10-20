import asyncio
from collections.abc import Callable

import structlog
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

log = structlog.get_logger()
LOCK_SQL = text("select pg_try_advisory_lock(hashtext('taktikfpl:scheduler'))")


class SchedulerLeader:
    """Hanya satu proses worker yang menjalankan APScheduler.

    Lock dipegang oleh SATU koneksi yang dibiarkan terbuka selama proses hidup.
    Koneksi harus lewat Session pooler (5432) atau direct, BUKAN transaction pooler (6543).
    """

    def __init__(
        self,
        engine: Engine,
        start_scheduler: Callable[[], None],
        stop_scheduler: Callable[[], None],
        retry_seconds: int = 30,
    ):
        self._engine = engine
        self._start = start_scheduler
        self._stop = stop_scheduler
        self._retry = retry_seconds
        self._conn: Connection | None = None
        self.is_leader = False

    def _try_acquire(self) -> Connection | None:
        conn = self._engine.connect()
        got = conn.execute(LOCK_SQL).scalar()
        conn.commit()  # tutup transaksi; advisory lock level sesi tetap dipegang
        if got:
            return conn
        conn.close()
        return None

    def _heartbeat(self) -> None:
        assert self._conn is not None
        self._conn.execute(text("select 1"))
        self._conn.commit()

    async def run(self) -> None:
        """Loop seumur proses: rebut lock, lalu jaga koneksi tetap hidup."""
        while True:
            try:
                if not self.is_leader:
                    conn = await asyncio.to_thread(self._try_acquire)
                    if conn is not None:
                        self._conn, self.is_leader = conn, True
                        log.info("scheduler.leader_acquired")
                        self._start()
                    else:
                        log.info("scheduler.standby")
                else:
                    await asyncio.to_thread(self._heartbeat)
            except Exception as exc:  # koneksi putus / DB sementara tidak tersedia
                log.warning("scheduler.leader_error", error=str(exc))
                self.release()  # hentikan scheduler; pemilihan ulang di putaran berikut
            await asyncio.sleep(self._retry)

    def release(self) -> None:
        if self.is_leader:
            self._stop()
        if self._conn is not None:
            try:
                self._conn.close()  # menutup koneksi otomatis melepas advisory lock
            except Exception:
                pass
        self._conn = None
        self.is_leader = False
