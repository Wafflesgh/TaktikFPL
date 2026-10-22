---
name: status-check
description: Ringkasan kesehatan TaktikFPL — data terbaru, job worker, fitur web produksi, jaringan/layanan. Use when the user types "status check", "cek status", "status aman?", or asks whether data is up to date, features are safe, or the network/services are healthy.
---

# Status check TaktikFPL

1. Jalankan dari root repo (±1 menit, hanya baca, tanpa secret):
   `bash scripts/status-check.sh`
2. Balas dalam **Bahasa Indonesia, singkat**, format tetap:

   **Status TaktikFPL — <waktu WIB>** · keseluruhan: ✅ Aman / ⚠️ Perlu perhatian / ❌ Bermasalah

   | Area | Status | Ringkas |
   |------|--------|---------|
   | Data | ✅/⚠️/❌ | sync FPL terakhir, proyeksi terakhir, berita 24 jam, GW & deadline berikutnya |
   | Worker & pemicu | … | jumlah job sehat, 204 terakhir, run GitHub Actions |
   | Fitur web | … | Home / klub / pemain / PWA: kode & waktu muat |
   | Jaringan & layanan | … | Supabase API, status GitHub / Supabase / Vercel |

   Lalu daftar singkat hanya untuk yang ⚠️/❌: apa masalahnya, dampaknya, dan saran perbaikan (jangan
   langsung mengubah apa pun; tanya dulu).

## Aturan penilaian
- **Job**: ❌ bila `last_status = failed`, `stuck = true`, atau `age_min > max_age_min`; ⚠️ bila `fails_24h > 0`
  tetapi run terakhir ok. Job tanpa `max_age_min` (gw_finalize, backfill, model_lab, deadline_checkpoint,
  build_form, set_active_model) hanya jalan saat dipicu — abaikan umurnya, nilai status terakhirnya saja.
- **Pemicu**: ❌ bila run terbaru bukan 204 (401/403 = token GitHub di Vault `github_dispatch_token` ditolak;
  404 = workflow/repo berubah) atau tidak ada baris dalam 30 menit terakhir (pg_cron mati).
- **Data**: ⚠️ bila proyeksi > 26 jam, berita terakhir masuk > 6 jam, snapshot harga bukan hari ini/kemarin
  (UTC), atau arsip 24 jam = 0. Ukuran DB ⚠️ bila > 400 MB (free tier 500 MB).
- **Web**: ❌ bila kode ≠ 200 atau `error_text > 0`; ⚠️ bila waktu muat > 5 detik.
- **Layanan**: ⚠️ bila status GitHub/Supabase/Vercel bukan "All Systems Operational"; Supabase REST harus 401
  (hidup tanpa key) — 000/5xx = ❌.
- Bila perintah DB gagal (mis. CLI belum login), laporkan sebagai ❌ "tidak bisa membaca DB" beserta pesannya.
