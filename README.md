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

## Job terjadwal (worker leader)

| Job | Jadwal | Isi |
|---|---|---|
| `sync_bootstrap` | 30 menit (5 menit di 24 jam terakhir sebelum deadline) | tim, pemain, status, harga, GW, deadline |
| `sync_fixtures` | 15 menit | fixture PL + deteksi perubahan jadwal + Blank/Double GW |
| `poll_event_status` | 10 menit | bonus terkonfirmasi, liga diperbarui, GW final |
| `sync_player_history` | harian 05:00 UTC | riwayat per laga → `player_fpl_gw_stats` |
| `build_form` | harian 06:00 UTC | form pemain (last4/last8/season + label) |
| `cleanup_retention` | harian 03:00 UTC | hapus data operasional lama |
| `deadline_checkpoint` | dinamis T-48j, T-24j, T-6j, T-2j, T-60m, T-15m | refresh penuh sebelum deadline |

## Test

```bash
cd services/worker && uv run ruff check . && uv run mypy app && uv run pytest -q
pnpm --filter web lint && pnpm --filter web typecheck && pnpm --filter web build
```
