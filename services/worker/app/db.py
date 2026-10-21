"""SQLAlchemy engine (psycopg3). Skema dikelola Supabase CLI; worker hanya mengikuti."""

import re
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from urllib.parse import quote, unquote

from sqlalchemy import create_engine
from sqlalchemy.engine import Connection, Engine

from app.config import get_settings

_URL_RE = re.compile(r"^(?P<scheme>[a-z+]+://)(?P<user>[^:@/]+):(?P<pw>.*)@(?P<rest>[^@/]+(?:/.*)?)$")


def repair_url(url: str) -> str:
    """Perbaiki kesalahan umum di DATABASE_URL tanpa mengubah maknanya.

    - Password dengan karakter khusus (@ : / ? # % …) di-percent-encode; batas password diambil
      dari '@' TERAKHIR sehingga '@' di dalam password tidak memotong URL.
    - Kurung siku sisa template `[YOUR-PASSWORD]` di sekitar password dibuang.
    """
    url = url.strip()
    m = _URL_RE.match(url)
    if not m:
        return url
    pw = m["pw"]
    if len(pw) >= 2 and pw.startswith("[") and pw.endswith("]"):
        pw = pw[1:-1]
    pw = quote(unquote(pw), safe="")
    return f"{m['scheme']}{m['user']}:{pw}@{m['rest']}"


def normalize_url(url: str) -> str:
    """Perbaiki format (repair_url) lalu postgresql:// → postgresql+psycopg:// (driver psycopg3)."""
    url = repair_url(url)
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
