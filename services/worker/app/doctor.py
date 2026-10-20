"""Diagnostik konfigurasi worker - aman untuk log publik (tidak pernah mencetak password/kunci).

    uv run python -m app.doctor

Dijalankan sebagai langkah pertama workflow agar kesalahan konfigurasi (mis. DATABASE_URL salah
format atau password tidak cocok) terbaca jelas dalam Bahasa Indonesia.
"""

import os
import sys
from urllib.parse import unquote, urlsplit

import httpx
import psycopg

RESERVED = set("@:/?#[]%")


def check_database_url(url: str) -> list[str]:
    """Masalah format DATABASE_URL (tanpa menyebut isi password)."""
    problems: list[str] = []
    if not url:
        return ["DATABASE_URL kosong - isi secret DATABASE_URL di GitHub."]
    if "[" in url or "]" in url:
        problems.append(
            "DATABASE_URL masih berisi tanda kurung siku [ ] - hapus, termasuk di sekitar password."
        )
    if "YOUR-PASSWORD" in url:
        problems.append("DATABASE_URL masih berisi teks [YOUR-PASSWORD] - ganti dengan password database.")
    if url.count("@") != 1:
        problems.append(
            "DATABASE_URL berisi lebih dari satu '@' - password kemungkinan mengandung '@'. "
            "Reset password database ke huruf+angka saja."
        )
    try:
        parts = urlsplit(url)
        parts.port  # noqa: B018 - memicu validasi port/host
    except ValueError:
        problems.append(
            "DATABASE_URL tidak bisa dibaca sebagai URL (biasanya karena [ ] atau karakter khusus)."
        )
        return problems
    if parts.scheme not in ("postgresql", "postgres"):
        problems.append(f"Skema harus postgresql://, bukan '{parts.scheme}://'.")
    host = parts.hostname or ""
    if host.startswith("db.") and host.endswith(".supabase.co"):
        problems.append(
            "Host memakai Direct connection (db.<ref>.supabase.co, hanya IPv6) - pakai string "
            "'Session pooler' dari tombol Connect (host ...pooler.supabase.com)."
        )
    if host.endswith("pooler.supabase.com"):
        if parts.port == 6543:
            problems.append("Port 6543 = Transaction pooler. Pakai Session pooler (port 5432).")
        if not (parts.username or "").startswith("postgres."):
            problems.append("User untuk pooler harus 'postgres.<project-ref>'.")
    password = unquote(parts.password or "")
    if not password:
        problems.append("Password tidak ditemukan di DATABASE_URL.")
    elif RESERVED & set(parts.password or ""):
        problems.append("Password berisi karakter khusus yang belum di-encode (@ : / ? # [ ] %).")
    return problems


def describe(url: str) -> str:
    try:
        p = urlsplit(url)
        p.port  # noqa: B018
    except ValueError:
        return "format tidak terbaca"
    pw = unquote(p.password or "")
    db = p.path.lstrip("/")
    return f"user={p.username} host={p.hostname} port={p.port} db={db} password={len(pw)} karakter"


def main() -> int:
    ok = True
    print("== Variabel lingkungan (hanya nama, isi tidak ditampilkan)")
    for name in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        present = bool(os.environ.get(name))
        print(f"   {name}: {'ada' if present else 'KOSONG'}")
        ok &= present

    url = os.environ.get("DATABASE_URL", "")
    print("== DATABASE_URL")
    if url:
        print("   " + describe(url))
    problems = check_database_url(url)
    for msg in problems:
        print("   MASALAH: " + msg)
    if not problems:
        try:
            with psycopg.connect(url, connect_timeout=15) as conn:
                version = conn.execute("show server_version").fetchone()
                seasons = conn.execute("select count(*) from public.seasons").fetchone()
            pg = version[0] if version else "?"
            print(f"   koneksi OK (Postgres {pg}, seasons={seasons[0] if seasons else 0})")
        except Exception as exc:  # pesan psycopg tidak memuat password
            ok = False
            msg = str(exc).strip().splitlines()[-1]
            print(f"   KONEKSI GAGAL: {msg}")
            if "password authentication failed" in msg:
                print("   -> Password di secret tidak cocok dengan password database saat ini.")
            if "tenant/user" in msg:
                print("   -> Host pooler salah: salin ulang string Session pooler dari tombol Connect.")
    else:
        ok = False

    supa, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", "")
    print("== Supabase Storage (arsip)")
    if supa and key:
        try:
            r = httpx.get(
                f"{supa.rstrip('/')}/storage/v1/bucket/archive", headers={"apikey": key}, timeout=15
            )
            print(
                f"   bucket 'archive': HTTP {r.status_code}",
                "OK" if r.status_code == 200 else "(cek SUPABASE_SECRET_KEY)",
            )
            # Storage hanya peringatan: sinkronisasi data tetap jalan walau arsip gagal.
        except httpx.HTTPError as exc:
            print(f"   PERINGATAN: {exc.__class__.__name__}")

    print("== API FPL")
    try:
        r = httpx.get(
            "https://fantasy.premierleague.com/api/event-status/",
            headers={"User-Agent": "TaktikFPL/0.1 (personal use)"},
            timeout=15,
        )
        print(f"   event-status: HTTP {r.status_code}")
    except httpx.HTTPError as exc:
        print(f"   GAGAL: {exc.__class__.__name__}")

    print("== HASIL: " + ("SEMUA OK" if ok else "ADA MASALAH - lihat baris di atas"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
