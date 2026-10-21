# ADR 0001 — Data dipertahankan bertahun-tahun untuk machine learning

- Status: **Diterima** · 2026-10-21
- Pemutus: Dilan (pemilik produk)

## Konteks

TaktikFPL ditargetkan berjalan **bertahun-tahun**. Data yang terkumpul akan dipakai untuk melatih
model (xMins, xPts, kapten, transfer) dan mengevaluasi rekomendasi. Model hanya sebaik riwayat
datanya, jadi landasan data harus dipertahankan.

Fakta yang membentuk keputusan ini:

1. **API FPL di-reset setiap awal musim.** `element-summary`, `event/{gw}/live`, harga, status, dan
   proyeksi resmi (`ep_next`) musim lalu tidak bisa diambil lagi. Yang tidak kita simpan, hilang.
2. Banyak fitur FPL di `bootstrap-static` (form resmi, `ep_next`, total transfer, urutan eksekutor
   set-piece, ICT) tidak dinormalisasi ke tabel, dan `raw_payloads` hanya disimpan 14 hari.
3. Kuota Supabase free tier: DB 500 MB, Storage 1 GB. Data turunan harian (mis. form) bisa tumbuh
   ratusan MB per tahun, sedangkan payload mentah ter-gzip sangat kecil (bootstrap 1,8 MB → ±170 KB,
   event live 470 KB → ±16 KB).
4. Training ML wajib **point-in-time**: fitur harus persis seperti yang diketahui saat keputusan
   diambil (sebelum deadline), bukan nilai yang sudah direvisi setelahnya (*data leakage*).

## Keputusan

1. **Fakta mentah tidak pernah dihapus.** Payload sumber eksternal diarsip sebagai file JSON gzip
   **immutable** di bucket privat `archive` (Supabase Storage), dengan manifest di tabel
   `public.data_archives` (sumber, endpoint, musim, GW, alasan, waktu, path, sha256, ukuran).
   - `daily`: `bootstrap-static/` dan `fixtures/` sekali per ±20 jam (`ARCHIVE_DAILY_MIN_HOURS`).
   - `deadline`: dipaksa di setiap checkpoint deadline (T-48j … T-15m) → snapshot keputusan.
   - `gw_final`: `event/{gw}/live/`, `fixtures/?event={gw}`, `dream-team/{gw}/`,
     `team/set-piece-notes/` saat GW final (self-healing: GW final tanpa arsip diproses ulang).
   - `season_end`: `element-summary` semua pemain + bootstrap di GW terakhir, sebelum API reset.
   - Understat (sejak 2026-10-21): `getLeagueData/EPL/{tahun}` harian (`daily`, ±20 jam) dan
     `getMatchData/{id}` sekali per laga selesai (`gw_final`; backfill musim lalu = `backfill`).
     Data per laga tidak masuk `raw_payloads` (hanya arsip) agar DB free tier tidak membengkak.
   - Isi identik dengan arsip terakhir endpoint yang sama tidak disimpan ulang.
2. **Tabel fakta permanen** (tidak pernah dipangkas): `player_status_snapshots`, `price_snapshots`,
   `player_fpl_gw_stats`, `fixtures`, `fixture_changes`, `match_events`, `lineups`, statistik laga,
   `news_items/entities`, `model_runs`, `projections`, `recommendations`, `model_evaluations`,
   `evidence`, `analysis_reports`, `data_archives`.
3. **Data turunan boleh dipangkas** karena bisa dihitung ulang dari arsip + tabel fakta, dengan satu
   pengecualian: snapshot fitur terakhir **sebelum setiap deadline GW** disimpan permanen (fitur
   yang benar-benar dipakai saat keputusan). Contoh: `player_form_features` harian > 30 hari dipangkas
   kecuali snapshot per-deadline.
4. **Data operasional** (`raw_payloads` 14 hari, `job_runs` 60 hari, `ai_cache` 30 hari) tetap dipangkas.
5. **Odds** (Fase 2): `odds_snapshots` tidak dipangkas sampai adapter mengarsip *closing odds*
   (snapshot terakhir sebelum kick-off) secara permanen.
6. **Versi**: setiap fitur/model menyimpan versinya (`model_version`, `prompt_version`, dan kunci
   versi di `metrics` fitur) agar dataset training bisa direkonstruksi.
7. **Skema hanya bertambah**: migrasi baru tidak menghapus kolom/tabel berisi fakta; perubahan
   makna kolom = kolom baru.

## Konsekuensi

- Perkiraan pertumbuhan arsip: ±70–100 MB/tahun (gzip) → muat di Storage free tier beberapa tahun;
  tabel fakta ±50–100 MB/tahun di DB. Setelah 2–3 musim kemungkinan perlu Supabase Pro.
- Dataset training ML dibangun dari arsip + tabel fakta (Fase 2: ekspor Parquet per musim).
- **Diputuskan 2026-10-21 (Dilan):**
  - Backup di luar Supabase = **folder lokal di laptop**, mingguan (`python -m app.backup`,
    Windows Task Scheduler). Snapshot DB dirotasi (8 terakhir), cermin arsip tidak pernah dihapus.
  - Musim 2016/17–2025/26 diimpor dari dataset komunitas vaastav sebagai data pendukung analisis &
    training (lisensi tidak dinyatakan → pemakaian pribadi; file asli diarsip untuk jejak asal-usul).
  - Tetap di **paket gratis** Supabase → ukuran DB dipantau; data turunan dipangkas sesuai keputusan #3.
