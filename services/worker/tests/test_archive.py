"""Arsip permanen: path, immutabilitas, dedupe, kompresi, dan upload ke Supabase Storage."""

import gzip
import json
from datetime import UTC, datetime

import httpx
import pytest

from app.archive.store import (
    LocalArchiveBackend,
    SupabaseArchiveBackend,
    archive_payload,
    build_path,
    canonical_bytes,
    read_archive,
)


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value


class FakeConn:
    """Meniru tabel data_archives cukup untuk logika dedupe."""

    def __init__(self):
        self.rows: list[dict] = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if sql.strip().startswith("select sha256"):
            same = [r for r in self.rows if r["source"] == params["s"] and r["endpoint"] == params["e"]]
            return FakeResult(same[-1]["sha"] if same else None)
        if "insert into public.data_archives" in sql:
            self.rows.append(dict(params))
            return FakeResult(None)
        raise AssertionError(f"SQL tak terduga: {sql}")


def test_build_path_is_partitioned_by_season_and_date():
    when = datetime(2026, 10, 20, 16, 35, 55, tzinfo=UTC)
    path = build_path("fpl", "2026/27", "event/7/live/", when, "gw_final", "abcdef1234567890")
    assert path == "fpl/2026-27/event-7-live/2026/10/20/163555Z-gw_final-abcdef12.json.gz"


def test_canonical_bytes_is_order_independent():
    assert canonical_bytes({"b": 1, "a": [1, 2]}) == canonical_bytes({"a": [1, 2], "b": 1})


def test_archive_roundtrip_and_dedupe(tmp_path):
    backend = LocalArchiveBackend(tmp_path)
    conn = FakeConn()
    payload = {"elements": [{"id": 1, "web_name": "Raya"}], "events": []}

    first = archive_payload(
        conn,
        source="fpl",
        endpoint="bootstrap-static/",
        payload=payload,
        reason="daily",
        season_label="2026/27",
        backend=backend,
    )
    assert not first.skipped_duplicate and first.path
    assert read_archive(first.path, backend) == payload
    assert gzip.decompress((tmp_path / first.path).read_bytes()) == canonical_bytes(payload)
    assert conn.rows[0]["backend"] == "local" and conn.rows[0]["season"] == "2026/27"

    # Isi identik → tidak disimpan ulang
    again = archive_payload(
        conn,
        source="fpl",
        endpoint="bootstrap-static/",
        payload=dict(payload),
        reason="daily",
        season_label="2026/27",
        backend=backend,
    )
    assert again.skipped_duplicate and again.path is None
    assert len(conn.rows) == 1

    # Isi berubah → arsip baru, arsip lama tetap ada
    changed = {**payload, "events": [{"id": 1}]}
    third = archive_payload(
        conn,
        source="fpl",
        endpoint="bootstrap-static/",
        payload=changed,
        reason="deadline",
        season_label="2026/27",
        backend=backend,
    )
    assert third.path and third.path != first.path
    assert (tmp_path / first.path).exists() and len(conn.rows) == 2


def test_local_backend_is_immutable(tmp_path):
    backend = LocalArchiveBackend(tmp_path)
    backend.put("a/b.json.gz", b"1")
    with pytest.raises(FileExistsError):
        backend.put("a/b.json.gz", b"2")
    assert backend.get("a/b.json.gz") == b"1"


def test_invalid_reason_rejected(tmp_path):
    with pytest.raises(ValueError):
        archive_payload(
            FakeConn(),
            source="fpl",
            endpoint="x",
            payload={},
            reason="whatever",
            season_label=None,
            backend=LocalArchiveBackend(tmp_path),
        )


def test_supabase_backend_uploads_without_overwrite():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = request.content
        return httpx.Response(200, json={"Key": "archive/x"})

    backend = SupabaseArchiveBackend(
        "https://ref.supabase.co", "sb_secret_dummy", transport=httpx.MockTransport(handler)
    )
    backend.put("fpl/2026-27/x.json.gz", b"data")
    assert seen["url"] == "https://ref.supabase.co/storage/v1/object/archive/fpl/2026-27/x.json.gz"
    assert seen["headers"]["apikey"] == "sb_secret_dummy"
    assert seen["headers"]["x-upsert"] == "false"
    assert "authorization" not in seen["headers"]  # kunci sb_secret_ bukan JWT
    assert seen["body"] == b"data"


def test_supabase_backend_raises_on_conflict():
    backend = SupabaseArchiveBackend(
        "https://ref.supabase.co",
        "sb_secret_dummy",
        transport=httpx.MockTransport(lambda r: httpx.Response(409, text=json.dumps({"error": "Duplicate"}))),
    )
    with pytest.raises(RuntimeError):
        backend.put("x", b"1")
