# ADR 0002 — Worker di GitHub Actions, backup ke Google Drive (semua gratis)

- Status: **Diterima** · 2026-10-21
- Pemutus: Dilan

## Konteks

TaktikFPL proyek pribadi dan harus berjalan **gratis**. Blueprint menaruh worker di Railway (always-on,
berbayar ±$5/bulan) dan belum menentukan backup di luar Supabase. Dilan memilih: Supabase paket gratis
sebagai database, backup ke **Google Drive** (tanpa salinan lokal), dan worker di **GitHub Actions**.

## Keputusan

1. **Worker = workflow `worker-tick`** (cron tiap 15 menit, repo publik → menit Actions gratis).
   `python -m app.tick` membaca `job_runs` + deadline GW berikut, lalu menjalankan job yang jatuh tempo:
   - `sync_fixtures` 15 menit; `sync_bootstrap` 30 menit (tiap tick di 24 jam terakhir sebelum deadline);
     `poll_event_status` 30 menit (memicu `gw_finalize` & arsip GW final);
   - harian: `cleanup_retention` (≥03:00 UTC), `sync_player_history` (≥05:00 UTC) lalu `build_form`;
   - checkpoint deadline T-48j/T-24j/T-6j/T-2j/T-60m/T-15m: dijalankan pada tick pertama setelah
     waktunya (toleransi 45 menit; jika beberapa terlewat, hanya yang paling dekat deadline).
   - `concurrency: worker` → tidak ada dua tick bersamaan, sehingga leader election tidak diperlukan.
   - Job manual lewat *Run workflow* (input `jobs`, mis. `backfill_history` atau `gw_finalize:gw=8`).
2. **Arsip** memakai Supabase Storage (`ARCHIVE_BACKEND=supabase`) karena runner tidak punya disk tetap.
3. **Backup = workflow `backup-gdrive`** (Minggu 10:00 WIB): `python -m app.backup` ke folder sementara
   runner → `rclone copy` ke `Google Drive/TaktikFPL-backup/`. Snapshot DB disimpan 8 minggu; cermin
   arsip permanen dan inkremental (file yang sudah ada di Drive dilewati).
4. Kode always-on (FastAPI + APScheduler + leader election, `Dockerfile`, `railway.toml`) **dipertahankan**
   sebagai opsi bila kelak pindah ke server; tidak dipakai di produksi.

## Konsekuensi & risiko

- Jadwal GitHub bisa telat 5–15 menit (kadang lebih saat GitHub sibuk). Untuk laporan T-60 masih aman;
  Live Match Center (Fase 3, polling per 60 detik) **tidak** bisa di Actions → perlu keputusan baru nanti.
- GitHub menonaktifkan jadwal setelah 60 hari tanpa aktivitas repo → langkah *keepalive* harian
  memanggil API `enable`. `/admin/health` menandai worker terlambat bila job terakhir > 45 menit.
- Endpoint komputasi on-demand (optimizer, what-if; Fase 2) tidak punya server → dihitung terjadwal
  dan disimpan ke DB, atau lewat Route Handler Vercel.
- API FPL harus bisa diakses dari IP runner GitHub — diuji workflow `fpl-probe` (sementara).
- Secret produksi disimpan sebagai GitHub Actions secrets (repo publik: tidak pernah di file).
