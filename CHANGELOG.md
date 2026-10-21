# Changelog

Semua perubahan penting TaktikFPL. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/).

## [0.15.0] — 2026-10-21 · Alasan dengan persentase + rincian xPts

### Ditambahkan
- xPts v1 mengeluarkan probabilitas per laga: main 60+ menit, mencetak gol, assist, bonus defcon.
- Alasan memuat persentase (mis. "38% to score, 27% to assist (xG 0.48 · xA 0.31)", "92% to play 60+",
  "top 4% of MIDs", gol yang diharapkan tim vs lawan); maks 6 alasan disimpan.
- Web: "Full breakdown" per pemain di Best XI — xPts per sumber poin, peluang, menit, model laga
  (gol diharapkan untuk/lawan), dan semua alasan.

## [0.14.0] — 2026-10-21 · My Team: tim baru vs tim yang sudah ada

### Ditambahkan
- `/tim` punya dua mode: **Start a new team** (15 pemain gratis, tanpa hit; squad 6 GW + alternatif) dan
  **I already have a team** (Team ID → squad, kapten, rencana transfer, catatan, opsi Wildcard).
- Rencana transfer multi-transfer (greedy, budget + bank + maks 3/klub): opsi 0..N transfer dengan gain 6 GW,
  hit −4 untuk transfer di luar free transfer, dan net; opsi terbaik ditandai.
- Free transfer diestimasi dari riwayat entry FPL (+1/GW, maks 5, Wildcard/Free Hit tidak mengubah; tim baru
  sebelum deadline pertama = tak terbatas) dan bisa dikoreksi pengguna (`?ft=`).

## [0.13.0] — 2026-10-21 · Alasan pemilihan, Best XI di Beranda, proyeksi ulang saat berita cedera

### Ditambahkan
- Worker `app/models/reasons.py`: alasan per pemain dari angka engine (template, bukan LLM) — cedera/diragukan
  (status + % peluang main + berita FPL), double/blank GW, laga mudah/sulit (pengali serangan vs laga rata-rata
  tim; peluang clean sheet untuk bek/kiper), label form 4 laga, statistik dasar top-% posisi, rangkaian 5 laga
  sesudahnya ("Easier run after this GW"), menit (nailed / rotasi). Disimpan di `component_breakdown.reasons`.
- `best_xi` (ILP): squad 15 pemain terbaik untuk GW berikutnya (budget £100m, XI + cadangan berurutan FPL,
  maks 3/klub) → `best_xi` di laporan
  `weekly_draft`. Web: panel **Best XI** di Beranda (lawan, xPts, alasan, kapten/vice).
- Web `/tim`: chip alasan di squad awal, squad sendiri, dan rekomendasi transfer.

### Diubah
- Tick: bila `sync_bootstrap` menemukan perubahan status/berita pemain, `run_projections` langsung dijalankan
  ulang (maks sekali per 30 menit) — sebelumnya hanya harian/checkpoint deadline.

## [0.12.0] — 2026-10-21 · xPts v1 per komponen + akurasi model

### Ditambahkan
- Aturan poin FPL dari `bootstrap-static game_config.scoring` → `fpl_scoring_rules` (tidak di-hardcode).
- `xpts_v1`: kekuatan serang/bertahan tim (19 laga, xG, prior promosi) × rate pemain ter-shrink → komponen
  menit, gol, assist, clean sheet, kebobolan, save, bonus, defcon, kartu; peluang main dari status/chance.
  Fallback ke v0 bila aturan poin belum tersimpan.
- Job `evaluate_model` (harian 07 UTC): backtest point-in-time per GW selesai vs baseline rata-rata 4 laga →
  `model_evaluations`. Web: bagian **Model accuracy** di halaman Analysis.

## [0.11.0] — 2026-10-21 · English UI

### Diubah
- Seluruh teks UI web diterjemahkan ke bahasa Inggris (keputusan Dilan); format tanggal en-GB, waktu tetap
  WIB; `<html lang="en">`. Alasan form dari worker juga berbahasa Inggris (berlaku setelah `build_form`
  berikutnya). URL halaman tidak berubah. Aturan #7 di CLAUDE.md diperbarui.

## [0.10.0] — 2026-10-21 · Tim Saya, proyeksi xPts 6 GW, rekomendasi & squad dari nol (Fase 2 awal)

### Ditambahkan
- Worker `app/models/xpts_v0.py`: xPts per pemain per laga = poin/90 (60% form 4 laga + 40% musim,
  ter-shrink) × xMins (porsi menit × peluang main dari status FPL) × faktor FDR × kandang/tandang.
- Job `run_projections` (harian setelah `build_form` + di setiap checkpoint deadline): proyeksi 6 GW ke depan,
  nilai horizon terdiskon 0.85/GW, squad optimal dari nol via ILP (PuLP 4 + solver HiGHS, dependensi baru
  `highspy`) disimpan sebagai laporan `weekly_draft`. Retensi: 3 run terbaru utuh; run `t60` permanen dan
  dipangkas ke GW-nya sendiri.
- Web `/tim` (navigasi Tim Saya aktif): input FPL Team ID (cookie), squad dari API FPL (server-side), strip
  xPts per GW, kapten/vice, rekomendasi transfer per posisi (budget + bank, maks 3/klub, diurutkan gain xPts
  6 GW), catatan **Tahan** (GW depan sulit tetapi GW sesudahnya bagus) / **Jual**, dan squad wildcard optimal.
- Test: xPts, horizon (kasus jadwal sulit lalu mudah), optimizer patuh aturan FPL, penjadwalan tick.

## [0.9.0] — 2026-10-21 · Tanpa login (keputusan Dilan)

### Diubah
- Login magic link dihapus: halaman `/login`, rute `/auth/*`, `proxy.ts` dan tombol Keluar.
  Migrasi `20261021000300_public_read.sql`: role `anon` boleh MEMBACA data FPL/analisis, view, dan status
  worker (`job_runs`, `api_usage`); data milik pengguna & tabel privat/biaya AI tetap tertutup.
  Test pgTAP disesuaikan (anon membaca players, tidak membaca watchlist).
- Preferensi (nama, tema, profil risiko) disimpan di cookie browser; `/admin/health` tanpa cek login.
- `DATABASE_URL` diperbaiki otomatis (password berkarakter khusus/kurung siku); `db-migrate` hanya jalan
  bila variabel `DB_MIGRATE_ENABLED=true`.

## [0.8.0] — 2026-10-21 · Pengaturan, Analisis harga, diagnostik worker

### Ditambahkan (diagnostik)
- `app.doctor`: langkah pertama `worker-tick` & `backup-gdrive` — memeriksa secret, format `DATABASE_URL`
  (kurung siku, `@` di password, host direct, transaction pooler), koneksi DB, Storage, dan API FPL
  dalam Bahasa Indonesia tanpa mencetak password/kunci. Tick pertama produksi gagal sebelum menulis apa
  pun ke DB; langkah ini membuat penyebabnya terbaca di log Actions.

### Ditambahkan
- Halaman **Pengaturan** (`/pengaturan`): ubah nama tampilan, tema (Violet/Ember/Pitch dengan pratinjau
  warna dari token tema masing-masing), dan profil risiko (Aman/Seimbang/Agresif + penjelasan singkat).
  Disimpan lewat Server Action ke `public.users` milik pengguna login (validasi Zod, RLS); pesan sukses/gagal.
- Menu profil di top bar kini punya tautan **Pengaturan** di atas "Keluar".
- Tile **Deadline** di Beranda kini countdown live (diperbarui tiap 30 detik, tanpa animasi).

### Diubah
- Root layout memasang `data-theme` dari `users.theme` pengguna login (fallback Violet untuk tamu atau
  bila Supabase gagal). `getViewer` kini di-`cache` per request dan ikut mengembalikan tema & profil risiko.
  Akibatnya `/login` dan `/_not-found` dirender dinamis.

### Ditambahkan (Hub Analisis: Harga & Transfer)
- Halaman **Analisis** (`/analisis`, desktop-first) sebagai hub; bagian pertama **Harga & Transfer**
  (BLUEPRINT fitur #13 Price watch) dari `price_snapshots`: perubahan harga naik/turun antara dua hari
  snapshot terakhir (£lama → £baru), top 15 net transfer masuk & keluar GW ini (masuk − keluar) dengan
  kepemilikan, harga, badge form, dan filter posisi (`?pos=`); sparkline harga 14 hari (SVG inline)
  per pemain; nama menaut ke `/pemain/{id}`. Data < 2 hari snapshot → pesan "Data harga belum cukup".
- `src/lib/data/analisis.ts` (server-only, query berhalaman agar aman dari batas 1000 baris PostgREST);
  tipe `price_snapshots` di `database.types.ts`. Navigasi Analisis aktif.

## [0.6.0] — 2026-10-21 · Halaman Jadwal & Profil Pemain (sesi Claude cloud)

### Ditambahkan
- Halaman **Jadwal** (`/jadwal`, desktop-first, BLUEPRINT 11.5 D): **Fixture Ticker** 6 GW (20 tim PL
  musim berjalan × GW berikut; lawan + H/A berwarna FDR, double = dua chip bertumpuk, blank = sel abu;
  urut FDR termudah atau nama via `?sort=`) dan **daftar laga per GW** (`?gw=`, default GW berikutnya)
  dikelompokkan per hari WIB dengan jam kick-off, FDR, skor akhir, status ditunda/dibatalkan, dan badge
  "Jadwal berubah" + ringkasan perubahan (`fixture_changes` 7 hari terakhir).
- `src/lib/data/jadwal.ts` (server-only) dan `src/lib/data/viewer.ts` (nama & status admin untuk top
  bar, kini dipakai juga oleh Beranda). Navigasi Jadwal aktif.
- Mobile 375 px: ticker digulir horizontal di dalam panel, kolom tim menempel; tanpa overflow halaman.
- Halaman `/pemain/[id]` (desktop-first): hero dengan headshot besar, klub, posisi, harga, kepemilikan,
  status/berita FPL, badge + alasan form; grafik batang poin per GW (SVG inline, 4 GW terakhir disorot);
  tabel laga musim ini (lawan, H/A, menit, poin, G, A, bonus, xG, xA) dan riwayat per musim sejak 2016/17
  (poin, menit, main, G, A, poin/90, xGI bila tersedia). Id divalidasi; id tak dikenal → 404.
- `src/lib/data/player.ts` (server-only).
- Nama pemain di tabel pemain & Form Teratas di Beranda kini menautkan ke profil.

## [0.5.0] — 2026-10-21 · Worker di GitHub Actions + backup ke Google Drive (semua gratis)

Keputusan Dilan: Supabase gratis, backup di Google Drive tanpa salinan lokal, worker di GitHub
Actions. Detail: `docs/adr/0002-worker-github-actions.md`.

### Ditambahkan
- `app/tick.py` + workflow `worker-tick` (cron 15 menit): menjalankan job yang jatuh tempo berdasarkan
  `job_runs` dan deadline GW (termasuk checkpoint T-48j … T-15m), job manual via *Run workflow*,
  keepalive jadwal harian. 8 test penjadwalan.
- Workflow `backup-gdrive` (Minggu 10:00 WIB): backup DB + arsip baru → Google Drive via rclone,
  rotasi snapshot 8 minggu. `app.backup --archive-skip-list` agar arsip tidak diunduh ulang.
- `/admin/health`: status worker dari job terakhir (peringatan bila > 45 menit).
- Siap publish (web): halaman `loading` (kerangka 3 kolom), `error` (tombol coba lagi; prop `retry`
  Next 16) dan `404`; pesan error login yang ramah (`?error=` dari magic link kedaluwarsa, pendaftaran
  ditutup, rate limit); ikon PWA PNG 192/512/maskable + apple-touch-icon; header keamanan
  (nosniff, DENY frame, referrer, permissions) + `noindex` (robots.txt, meta, X-Robots-Tag);
  pesan 503 jelas bila env Supabase belum diisi. Proxy tidak lagi mengalihkan `robots.txt`/ikon ke
  login, dan regex matcher-nya diperbaiki (`\.` agar benar-benar mencocokkan titik).

### Dihapus / diubah
- Skrip Task Scheduler Windows (backup lokal) dihapus — diganti backup ke Google Drive.
- Railway tidak dipakai (berbayar); `Dockerfile`/`railway.toml`/scheduler always-on tetap sebagai opsi.

## [0.4.0] — 2026-10-21 · Data historis 2016/17–2025/26 + backup lokal mingguan

Keputusan Dilan: backup lokal mingguan; dataset vaastav dipakai sebagai data pendukung; tetap di
paket gratis Supabase.

### Ditambahkan
- Migrasi `20261021000100_history_features.sql` (aditif): `player_fpl_gw_stats` + `team_id`,
  `opponent_team_id`, `was_home`, `starts`, `fpl_xp` (proyeksi resmi FPL), `transfers_in/out/balance`,
  `source`, `extra` (statistik khusus musim, mis. tackles/recoveries 2016/17);
  `gameweeks.deadline_estimated`; `seasons.data_source`.
- `app/sources/vaastav.py` + job `backfill_history`: impor 10 musim (2016/17–2025/26) — 258 ribu baris
  statistik per laga, 380 fixture/musim (2016/17–2017/18 direkonstruksi dari data per pemain), GW COVID
  2019/20 (39–47 → 30–38), baris manajer 2024/25 dilewati. Diverifikasi: klasemen 2016/17 yang dihitung
  ulang cocok dengan sejarah (Chelsea 93, Spurs 86). File CSV asli diarsip permanen (sumber `vaastav`).
- `sync_player_history` kini juga mengisi tim, lawan, kandang/tandang, starts, dan transfer per laga.
- `app/backup.py`: backup DB via COPY (CSV gzip per tabel + manifest sha256 + versi migrasi), cermin
  arsip inkremental dengan verifikasi checksum, rotasi snapshot (default 8), dan `restore` — diuji
  pulang-pergi: 56 tabel, 0 selisih baris. `scripts/backup-weekly.ps1` &
  `scripts/register-backup-task.ps1` (Windows Task Scheduler, Minggu 10:00).
- CLI menerima nilai berkoma: `backfill_history:seasons=2024-25,2025-26`.

### Catatan kuota (paket gratis)
- DB setelah backfill: ±172 MB dari 500 MB (tabel terbesar `player_fpl_gw_stats` ±148 MB).
  Pertumbuhan ±20–30 MB/musim. Arsip vaastav ±12 MB di Storage (dari 1 GB).

## [0.3.0] — 2026-10-21 · UI desktop-first dari referensi desain

Permintaan Dilan: ikuti referensi tampilan, desktop diutamakan.

### Diubah
- Beranda dirombak desktop-first mengikuti ref-02 (dashboard 3 kolom, panel kaca, top bar dengan
  navigasi pill berikon + indikator Live + profil): kolom kiri **GW Overview** (pemain terpanas,
  kartu statistik deadline/laga/form panas/jadwal berubah), **Form Teratas** (garis progres ala panel
  AI Prediction), **Perlu Diwaspadai** (pemain populer tidak fit); kolom tengah **Sorotan Form** (hero
  pemain), **Jadwal GW** dalam WIB + FDR + penanda perubahan, **tabel pemain** (filter posisi, urut
  form/harga/kepemilikan/xGI); kolom kanan **Laga Berikutnya/Live** dan **Klasemen** (dihitung dari
  hasil fixture final).
- Mobile (ref-01 & ref-03): kolom bertumpuk, bottom nav mengambang berbentuk pill; tanpa overflow
  horizontal di 375 px. Halaman Analisis/Live/Jadwal/Tim Saya ditandai "segera".
- Tampilan dipisah ke `DashboardView` (komponen murni) dan data ke `lib/data/dashboard.ts`.
- `PlayerHeadshot`: ukuran `xl` untuk hero; fallback foto juga berjalan bila gambar gagal sebelum
  hidrasi React (idempoten, aman untuk efek ganda StrictMode).
- `.glass` dipindah ke `@layer components` agar bisa ditimpa utilitas; top bar memakai latar
  hampir solid supaya konten tidak tembus saat di-scroll.
- Diverifikasi visual di 1600 px, 1280 px, dan 375 px dengan snapshot data nyata (668 pemain, GW8).

## [0.2.0] — 2026-10-21 · Fondasi data jangka panjang untuk ML

Permintaan Dilan: data harus dipertahankan bertahun-tahun untuk machine learning.
Keputusan lengkap: `docs/adr/0001-data-arsip-jangka-panjang.md`.

### Ditambahkan
- Migrasi `20261020001600_archive.sql`: bucket privat `archive`, tabel manifest `data_archives`
  (RLS: baca admin), index `player_form_features(as_of)`.
- `app/archive/store.py`: arsip JSON gzip immutable (backend Supabase Storage atau folder lokal),
  sha256, dedupe isi identik, path per sumber/musim/endpoint/tanggal.
- Arsip `daily` (bootstrap & fixtures), `deadline` (dipaksa di setiap checkpoint deadline),
  `gw_final` (job `gw_finalize`: event live, fixtures GW, dream team, set-piece notes; menandai
  `player_fpl_gw_stats.is_final`), `season_end` (job `archive_season_snapshot`: element-summary semua
  pemain di GW terakhir sebelum API FPL reset). `poll_event_status` memicu `gw_finalize` untuk setiap
  GW final yang belum diarsip (self-healing, termasuk GW lampau saat aplikasi mulai di tengah musim).
- CLI menerima argumen job: `python -m app.cli gw_finalize:gw=7`.
- Aturan inti #9 di `CLAUDE.md`.

### Diubah
- `cleanup_retention`: `odds_snapshots` **tidak lagi dipangkas** (90 hari di blueprint) sampai closing
  odds diarsip permanen; `player_form_features` harian > 30 hari dipangkas **kecuali** snapshot terakhir
  sebelum setiap deadline GW (point-in-time untuk training).

## [0.1.0] — 2026-10-20 · Fase 1: Fondasi data

Eksekusi `docs/INFRA_BLUEPRINT.md` Bagian 12 (Langkah 1–5, 8–11 secara lokal) + Fase 1 `docs/BLUEPRINT.md`.

### Ditambahkan
- **Monorepo**: `package.json` + `pnpm-workspace.yaml` (pnpm), `docker-compose.yml` (Redis), `railway.toml`,
  `.gitleaks.toml`, `.gitignore`, `CLAUDE.md` (Master Prompt), `docs/BLUEPRINT.md`, `docs/INFRA_BLUEPRINT.md`.
- **Database** (`supabase/`): 14 migrasi persis dari INFRA_BLUEPRINT Bagian 5 (56 tabel, 4 view, RLS di semua
  tabel, Realtime, Storage), `seed.sql`, pgTAP `tests/001_rls_test.sql`, `config.toml` (redirect auth lokal).
- **Migrasi tambahan** `20261020001500_form_view.sql`: view `v_player_form` + index form terbaru.
- **Worker** (`services/worker`): FastAPI + leader election (advisory lock) + APScheduler (jobstore di schema
  `scheduler`), `SourceClient` (rate-limit, retry 429/5xx, `raw_payloads`, `api_usage`, kuota harian),
  adapter FPL, job `sync_bootstrap`, `sync_fixtures` (deteksi perubahan jadwal → `fixture_changes`,
  hitung Blank/Double GW), `poll_event_status`, `cleanup_retention`, checkpoint deadline dinamis
  (T-48j … T-15m + `sync_bootstrap` tiap 5 menit di H-1), `GET /v1/health`, `GET /v1/gameweeks/current`,
  `POST /v1/admin/jobs/{name}/run`, CLI `python -m app.cli <job>`.
- **Form pemain** (permintaan Dilan, bagian dari BLUEPRINT 4.2.2/4.8 yang dimajukan dari Fase 2):
  job `sync_player_history` (element-summary → `player_fpl_gw_stats`, harian 05:00 UTC) dan `build_form`
  (06:00 UTC) → `player_form_features` jendela `last4`/`last8`/`season`: poin/laga, xG/xA/xGI/DefCon per 90
  dengan shrinkage ke rata-rata posisi, tren underlying vs baseline musim pemain, persentil posisi,
  flag over/underperform (G−xG), label `panas/bagus/stabil/menurun/dingin/minim_menit` + alasan.
- **Web** (`apps/web`): Next.js 16 + Tailwind 4, Supabase SSR (magic link, `proxy.ts` proteksi rute),
  Beranda (GW + countdown deadline WIB, jadwal GW berikut dalam WIB + badge "Jadwal berubah",
  daftar pemain dengan headshot + fallback inisial + badge form, filter posisi, urut form/harga/kepemilikan),
  `/admin/health` (job_runs + health worker), manifest PWA, design tokens BLUEPRINT 11.2.
- **CI/CD**: `.github/workflows/ci.yml` & `db-migrate.yml` persis dari blueprint.
- Test worker: 37 test (contract parser FPL dengan sampel JSON nyata 2026/27, deteksi perubahan jadwal,
  leader election, retry HTTP, form).

### Penyimpangan dari blueprint (dan alasannya)
- `packageManager` `pnpm@9.12.0` → `pnpm@9.15.9` (versi yang terpasang; blueprint mengizinkan naik versi).
- `services/worker/app/scheduler/leader.py`: hanya ditambah anotasi tipe (`Connection | None`, `Callable`,
  `assert` di `_heartbeat`) agar `mypy app` di CI lolos. Logika identik.
- `services/worker/pyproject.toml`: ditambah `[tool.ruff.lint]` dan `[tool.mypy]` (`ignore_missing_imports`)
  karena CI menjalankan `ruff check` dan `mypy app`.
- `raw_payloads`: payload sukses untuk endpoint yang sama disimpan paling sering sekali per 6 jam
  (`DEFAULT_RAW_MIN_INTERVAL_MIN`), dan job massal `sync_player_history` tidak menyimpan payload sukses.
  Alasan: bootstrap-static ±1.8 MB × tiap 30 menit × retensi 14 hari ≈ 1 GB, melebihi kuota DB free tier.
  Payload error selalu disimpan.
- `team_external_ids(source='fpl')` memakai `code` tim (stabil antar musim), bukan `id` 1..20 yang berganti
  tiap musim — agar primary key `(source, external_id)` tidak bentrok di musim berikutnya.
- `fixture_changes` tidak mencatat `created` saat impor awal (tabel fixture kosong), supaya semua laga
  tidak tertandai "Jadwal berubah" selama 7 hari. Progres status normal (scheduled → live → finished)
  juga tidak dicatat; hanya transisi yang melibatkan postponed/cancelled/abandoned/tbc.
- `gameweeks.scores_final_at` di-set bila `is_finished` (bootstrap) **dan** bonus terkonfirmasi **dan** liga
  diperbarui (`event-status/`), karena `event-status` juga melaporkan bonus harian di tengah GW.
- `seasons.end_date` diisi dari tanggal deadline GW terakhir (laga GW38 dimainkan di hari yang sama).
- Worker menerima `SUPABASE_JWT_SECRET` opsional untuk project yang masih memakai JWT HS256 (legacy);
  project baru memakai JWKS (`SUPABASE_JWKS_URL`). Ditambahkan ke `.env.example`.
- `.env.example`: template foto/badge diisi dengan pola CDN yang sudah diverifikasi (HTTP 200, 2026-10-20).
- Web: Next.js 16 mengganti `middleware.ts` menjadi `src/proxy.ts`; manifest via `src/app/manifest.ts`
  (disajikan di `/manifest.webmanifest`, setara `public/manifest.webmanifest`); `cacheComponents: false`
  karena semua halaman membaca sesi per request; `next.config.ts` memuat `.env` root monorepo.
- `apps/web/src/lib/database.types.ts` **sementara ditulis tangan** (format sama dengan `supabase gen types`)
  karena `supabase start` butuh Docker yang belum terpasang. Jalankan `pnpm db:types` untuk menggantinya.

### Belum dikerjakan / butuh tindakan Dilan
- Langkah 1: **Docker Desktop** belum terpasang → `supabase start`, `supabase test db`, `pnpm db:types`,
  dan Redis lokal belum dijalankan di mesin ini. Migrasi sudah divalidasi di Postgres portabel dengan stub
  skema Supabase (56 tabel, 4 view, 2 bucket, 7 tabel Realtime, 9/9 cek RLS setara pgTAP), dan pipeline FPL
  dijalankan terhadapnya dengan data nyata.
- Langkah 3: `supabase login` + `supabase link` (butuh login Dilan & project ref); sesuaikan
  `[db] major_version` di `supabase/config.toml` dengan versi Postgres project produksi (default 17).
- Langkah 6–7: migrasi produksi menunggu persetujuan eksplisit Dilan.
- Langkah 11: GitHub secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` +
  environment `production` dengan required reviewer.
- Langkah 12: deploy Railway & Vercel.
- `docs/design/ref-0{1,2,3}-*.png` belum ada di repo (gambar referensi UI belum dilampirkan).
- Sisa Fase 1 BLUEPRINT 15 yang belum dikerjakan: adapter API-Football (butuh `API_FOOTBALL_KEY`),
  adapter Understat, dan `entity_resolver` (pencocokan pemain antar sumber).
