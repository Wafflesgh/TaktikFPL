# TaktikFPL

Asisten analisis & rekomendasi Fantasy Premier League bertenaga AI (Gemini), untuk satu pengguna utama (WIB).

- Spesifikasi produk: [docs/BLUEPRINT.md](docs/BLUEPRINT.md)
- Database & infrastruktur: [docs/INFRA_BLUEPRINT.md](docs/INFRA_BLUEPRINT.md)
- Aturan untuk Claude Code: [CLAUDE.md](CLAUDE.md) · Riwayat & penyimpangan: [CHANGELOG.md](CHANGELOG.md)

> Repo ini **publik**. Jangan pernah commit `.env`, password DB, `sb_secret_…`, cookie FPL, atau API key.

## Struktur

```text
apps/web          Next.js 16 (PWA) — UI, login magic link, Supabase SSR
services/worker   Python 3.12 — FastAPI + APScheduler, adapter data, fitur & model
supabase/         Migrasi SQL (satu-satunya sumber skema), seed, test pgTAP
```

## Prasyarat

Node ≥ 22, pnpm 9, Python 3.12 + [uv](https://docs.astral.sh/uv/), Docker Desktop (untuk `supabase start` & Redis).

## Menjalankan lokal

```bash
cp .env.example .env            # isi nilai lokal (lihat INFRA_BLUEPRINT 9.2)
pnpm install
pnpm db:start                   # Supabase lokal (Docker)
pnpm db:reset                   # migrasi + seed dari nol
pnpm db:test                    # pgTAP: 8/8 ok
pnpm db:types                   # generate apps/web/src/lib/database.types.ts
pnpm redis:up
pnpm dev:worker                 # http://127.0.0.1:8000/v1/health
pnpm dev:web                    # http://127.0.0.1:3000
```

Isi data awal dari FPL (sekali, tanpa menunggu scheduler):

```bash
cd services/worker
uv run python -m app.cli sync_bootstrap sync_fixtures poll_event_status
uv run python -m app.cli sync_player_history build_form   # ±11 menit (1 request/detik)
```

## Produksi (gratis): Supabase + GitHub Actions + Vercel + Google Drive

1. Buat project Supabase (paket Free), jalankan migrasi (`pnpm exec supabase db push --include-seed`).
2. GitHub → Settings → Secrets and variables → Actions → **Secrets**: `DATABASE_URL` (Session pooler),
   `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RCLONE_CONFIG`, dan kunci API opsional (`GEMINI_API_KEY`, …).
   **Variables**: `FPL_TEAM_ID`.
3. `RCLONE_CONFIG` (sekali, di laptop): pasang rclone (`winget install Rclone.Rclone`), lalu
   `rclone config create gdrive drive scope=drive.file` (login Google di browser), lalu salin isi
   `rclone config file` → base64 → secret `RCLONE_CONFIG`.
4. Isi data awal: Actions → **worker-tick** → *Run workflow* dengan `jobs` =
   `sync_bootstrap sync_fixtures poll_event_status backfill_history sync_player_history build_form`.
5. Web di Vercel (Root Directory `apps/web`).

## Job terjadwal (GitHub Actions `worker-tick`, tiap 15 menit)

| Job | Jadwal | Isi |
|---|---|---|
| `sync_bootstrap` | 30 menit (tiap tick di 24 jam terakhir sebelum deadline) | tim, pemain, status, harga, GW, deadline |
| `sync_fixtures` | 15 menit | fixture PL + deteksi perubahan jadwal + Blank/Double GW |
| `poll_event_status` | 30 menit | bonus terkonfirmasi, GW final → arsip `gw_final` |
| `sync_player_history` | harian 05:00 UTC | riwayat per laga → `player_fpl_gw_stats` |
| `build_form` | harian 06:00 UTC | form pemain (last4/last8/season + label) |
| `cleanup_retention` | harian 03:00 UTC | hapus data operasional lama |
| `deadline_checkpoint` | tick pertama setelah T-48j, T-24j, T-6j, T-2j, T-60m, T-15m | refresh penuh + arsip `deadline` |
| `backfill_history` | manual | impor musim 2016/17–2025/26 (dataset vaastav) |
| backup Google Drive | Minggu 10:00 WIB (workflow `backup-gdrive`) | snapshot DB + arsip baru |

## Test

```bash
cd services/worker && uv run ruff check . && uv run mypy app && uv run pytest -q
pnpm --filter web lint && pnpm --filter web typecheck && pnpm --filter web build
```
