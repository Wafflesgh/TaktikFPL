"""Backup lokal (di laptop Dilan), dijalankan mingguan — docs/adr/0001-data-arsip-jangka-panjang.md.

    uv run python -m app.backup                 # backup DB + cermin arsip ke BACKUP_DIR
    uv run python -m app.backup --keep 8        # simpan 8 snapshot DB terakhir (arsip tidak dihapus)
    uv run python -m app.backup restore --src <folder-snapshot> --target-url <postgres-url> --yes

Konfigurasi produksi dibaca dari `.env.backup` di root repo (di-ignore git) bila ada:
DATABASE_URL (Session pooler produksi), SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_DIR.

Isi folder BACKUP_DIR:
    db/2026-10-25T030000Z/<schema>.<tabel>.csv.gz + manifest.json   (snapshot penuh, dirotasi)
    archive/<path arsip>                                            (cermin bucket, tidak pernah dihapus)
Tanpa pg_dump/Docker: memakai COPY lewat psycopg. Skema dipulihkan dari supabase/migrations.
"""

import argparse
import gzip
import hashlib
import json
import os
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_BACKUP_DIR = REPO_ROOT.parent / "TaktikFPL-backup"
SKIP_TABLES = {"raw_payloads"}  # cache debug 14 hari; payload permanen ada di arsip


def load_backup_env(env_file: Path) -> None:
    """Variabel di .env.backup menimpa .env lokal (koneksi produksi hanya untuk backup)."""
    if env_file.exists():
        from dotenv import dotenv_values

        for k, val in dotenv_values(env_file).items():
            if val is not None:
                os.environ[k] = val


def _engine(url: str) -> Engine:
    from app.db import normalize_url

    return create_engine(normalize_url(url), pool_pre_ping=True)


def table_order(engine: Engine) -> list[str]:
    """Tabel public diurutkan topologis berdasarkan foreign key (induk dulu)."""
    with engine.connect() as conn:
        tables = [
            r[0]
            for r in conn.execute(
                text("select tablename from pg_tables where schemaname = 'public' order by tablename")
            )
        ]
        deps = conn.execute(
            text(
                """
            select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
            from pg_constraint c
            join pg_namespace n on n.oid = c.connamespace
            where c.contype = 'f' and n.nspname = 'public'
            """
            )
        ).all()
    parents: dict[str, set[str]] = {t: set() for t in tables}
    for child, parent in deps:
        c, p = child.removeprefix("public."), parent.removeprefix("public.")
        if c in parents and p in parents and c != p:
            parents[c].add(p)
    ordered: list[str] = []
    while parents:
        ready = sorted(t for t, ps in parents.items() if not ps)
        if not ready:  # siklus (tidak diharapkan) → sisanya alfabetis
            ready = sorted(parents)
        for t in ready:
            ordered.append(t)
            parents.pop(t)
        for ps in parents.values():
            ps.difference_update(ready)
    return ordered


def _migration_versions(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        exists = conn.execute(text("select to_regclass('supabase_migrations.schema_migrations')")).scalar()
        if not exists:
            return []
        return [
            r[0]
            for r in conn.execute(
                text("select version from supabase_migrations.schema_migrations order by version")
            )
        ]


def dump_database(engine: Engine, dest: Path) -> dict[str, Any]:
    dest.mkdir(parents=True, exist_ok=False)
    tables = [t for t in table_order(engine) if t not in SKIP_TABLES]
    entries = []
    raw = engine.raw_connection()
    try:
        cur = raw.driver_connection.cursor()  # type: ignore[union-attr]
        # Snapshot konsisten untuk semua tabel
        cur.execute("begin isolation level repeatable read read only")
        for t in tables:
            path = dest / f"public.{t}.csv.gz"
            h = hashlib.sha256()
            size = 0
            with (
                gzip.open(path, "wb", compresslevel=6) as out,
                cur.copy(
                    f'copy (select * from public."{t}") to stdout with (format csv, header true)'
                ) as copy,
            ):
                for block in copy:
                    data = bytes(block)
                    h.update(data)
                    size += len(data)
                    out.write(data)
            rows = cur.execute(f'select count(*) from public."{t}"').fetchone()[0]
            entries.append({"table": t, "rows": rows, "csv_bytes": size, "sha256": h.hexdigest()})
        cur.execute("commit")
    finally:
        raw.close()
    manifest = {
        "created_at": datetime.now(UTC).isoformat(),
        "format": "csv+gzip via COPY",
        "table_order": [e["table"] for e in entries],
        "tables": entries,
        "migrations": _migration_versions(engine),
        "skipped_tables": sorted(SKIP_TABLES),
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def mirror_archive(engine: Engine, dest: Path) -> dict[str, int]:
    """Unduh file arsip yang belum ada di lokal; verifikasi sha256 isi. Tidak pernah menghapus."""
    from app.archive.store import get_backend

    backend = get_backend()
    with engine.connect() as conn:
        rows = conn.execute(text("select path, sha256 from public.data_archives order by id")).all()
    new = verified_fail = 0
    for path, sha in rows:
        target = dest / path
        if target.exists():
            continue
        data = backend.get(path)
        if hashlib.sha256(gzip.decompress(data)).hexdigest() != sha:
            verified_fail += 1
            print(f"PERINGATAN: checksum tidak cocok, dilewati: {path}", file=sys.stderr)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        new += 1
    return {"total": len(rows), "downloaded": new, "checksum_failed": verified_fail}


def rotate(db_dir: Path, keep: int) -> list[str]:
    snaps = sorted(p for p in db_dir.iterdir() if p.is_dir() and (p / "manifest.json").exists())
    removed = []
    for old in snaps[:-keep] if keep > 0 else []:
        shutil.rmtree(old)
        removed.append(old.name)
    return removed


def restore(src: Path, target_url: str) -> dict[str, Any]:
    """Pulihkan snapshot ke DB yang SUDAH berisi skema (supabase db reset / migrasi)."""
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    engine = _engine(target_url)
    missing = sorted(set(manifest["migrations"]) - set(_migration_versions(engine)))
    if missing:
        raise SystemExit(f"Skema target belum lengkap, migrasi hilang: {missing}")
    raw = engine.raw_connection()
    restored = []
    try:
        cur = raw.driver_connection.cursor()  # type: ignore[union-attr]
        cur.execute("begin")
        cur.execute("set local session_replication_role = replica")  # trigger & FK tidak dipicu
        order = manifest["table_order"]
        cur.execute("truncate " + ", ".join(f'public."{t}"' for t in order) + " restart identity cascade")
        for t in order:
            with (
                gzip.open(src / f"public.{t}.csv.gz", "rb") as f,
                cur.copy(f'copy public."{t}" from stdin with (format csv, header true)') as copy,
            ):
                while chunk := f.read(1 << 20):
                    copy.write(chunk)
            # Sinkronkan sequence serial dengan id maksimum
            for (seq_col,) in cur.execute(
                "select a.attname from pg_attribute a where a.attrelid = %s::regclass and a.attnum > 0 "
                "and pg_get_serial_sequence(%s, a.attname) is not null",
                (f"public.{t}", f"public.{t}"),
            ).fetchall():
                cur.execute(
                    f"select setval(pg_get_serial_sequence('public.\"{t}\"', %s), "
                    f'coalesce((select max("{seq_col}") from public."{t}"), 0) + 1, false)',
                    (seq_col,),
                )
            restored.append(t)
        cur.execute("commit")
    finally:
        raw.close()
    with engine.connect() as conn:
        counts = {t: conn.execute(text(f'select count(*) from public."{t}"')).scalar() for t in restored}
    mismatched = {
        e["table"]: (counts.get(e["table"]), e["rows"])
        for e in manifest["tables"]
        if counts.get(e["table"]) != e["rows"]
    }
    return {"tables": len(restored), "row_mismatch": mismatched}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.backup")
    parser.add_argument("command", nargs="?", default="backup", choices=["backup", "restore"])
    parser.add_argument("--env-file", default=str(REPO_ROOT / ".env.backup"))
    parser.add_argument("--dest", default=None, help="folder backup (default BACKUP_DIR)")
    parser.add_argument("--keep", type=int, default=8, help="jumlah snapshot DB yang disimpan")
    parser.add_argument("--no-archive", action="store_true", help="lewati cermin arsip")
    parser.add_argument("--src", help="restore: folder snapshot db/<waktu>")
    parser.add_argument("--target-url", help="restore: URL Postgres tujuan")
    parser.add_argument("--yes", action="store_true", help="restore: konfirmasi menimpa data tujuan")
    args = parser.parse_args(argv)

    load_backup_env(Path(args.env_file))
    if args.command == "restore":
        if not (args.src and args.target_url and args.yes):
            parser.error("restore butuh --src, --target-url, dan --yes (data tujuan akan DITIMPA)")
        print(json.dumps(restore(Path(args.src), args.target_url), indent=2))
        return 0

    from app.config import get_settings

    settings = get_settings()
    base = Path(args.dest or os.environ.get("BACKUP_DIR") or DEFAULT_BACKUP_DIR)
    engine = _engine(settings.database_url)
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ")
    manifest = dump_database(engine, base / "db" / stamp)
    result: dict[str, Any] = {
        "dest": str(base),
        "snapshot": stamp,
        "tables": len(manifest["tables"]),
        "rows": sum(t["rows"] for t in manifest["tables"]),
    }
    if not args.no_archive:
        result["archive"] = mirror_archive(engine, base / "archive")
    result["rotated_out"] = rotate(base / "db", args.keep)
    log_line = json.dumps(result, ensure_ascii=False)
    with (base / "backup.log").open("a", encoding="utf-8") as f:
        f.write(log_line + "\n")
    print(log_line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
