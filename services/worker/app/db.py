"""SQLAlchemy engine (psycopg3). Skema dikelola Supabase CLI; worker hanya mengikuti."""

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Connection, Engine

from app.config import get_settings


def normalize_url(url: str) -> str:
    """postgresql:// atau postgres:// → postgresql+psycopg:// (driver psycopg3)."""
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        normalize_url(get_settings().database_url),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
    )


@contextmanager
def transaction() -> Iterator[Connection]:
    """Satu transaksi: commit jika sukses, rollback jika error."""
    with get_engine().begin() as conn:
        yield conn
