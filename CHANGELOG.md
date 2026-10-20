# Changelog

Semua perubahan penting TaktikFPL. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/).

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
