# TaktikFPL — Status Blueprint (per 2026-10-21)

> Baca file ini PERTAMA di sesi baru. Ringkasan lengkap: apa yang sudah jalan, infrastruktur, database,
> worker, web, model, tool/MCP, cara kerja dengan pengguna, dan backlog. Spesifikasi produk penuh tetap di
> `docs/BLUEPRINT.md`; SQL/infra di `docs/INFRA_BLUEPRINT.md`; keputusan di `docs/adr/`; riwayat di `CHANGELOG.md`.

---

## 1. Cara kerja dengan pengguna (Dilan)

- Chat dalam **Bahasa Indonesia**, singkat. **UI web 100% bahasa Inggris**. Waktu ditampilkan WIB, disimpan UTC.
- Semua harus **GRATIS**: Supabase free, worker di GitHub Actions, Vercel Hobby, backup Google Drive (rclone).
- **Persetujuan = kata "next"** (bukan "ya"). Tanya dulu sebelum: push ke `main`, `supabase db push` (DB produksi),
  merge PR. Alur yang benar: minta "next" → push → BARU beri perintah workflow `worker-tick` (langkah terpisah;
  jangan digabung dalam satu pesan — pengguna pernah menjalankan workflow sebelum push).
- Pengguna menjalankan workflow manual dari GitHub Actions UI (tidak ada `gh` CLI di mesin ini) lalu membalas "done".
- Repo PUBLIK: jangan pernah commit/tampilkan secret, password DB, `sb_secret_…`, cookie FPL, API key.
- Git identity: `Wafflesgh <Wafflesgh@users.noreply.github.com>`. Setiap commit diakhiri
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Deskripsi PR diakhiri
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Aturan inti CLAUDE.md: angka dari engine (bukan LLM); jangan hardcode nama klub/pemain/aturan poin;
  semua sumber eksternal lewat adapter + arsip; data fakta tidak pernah dihapus (ADR 0001).

## 2. Infrastruktur

| Komponen | Detail |
|---|---|
| Repo | https://github.com/Wafflesgh/TaktikFPL (publik), monorepo pnpm (`apps/web`) + uv (`services/worker`, Python 3.12) |
| Web | Next.js 16.4 (App Router, `cacheComponents: false`, prop `error.tsx` = `retry`) di **Vercel Hobby**, region `syd1` (`apps/web/vercel.json`), URL **https://taktik-fpl.vercel.app**, deploy otomatis dari `main` (root `apps/web`). Env Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, 3 template foto/badge. Tanpa login (anon read). |
| DB | **Supabase free**, project ref `nkbnxrjbdwkqmqazkmvz` (Sydney), URL `https://nkbnxrjbdwkqmqazkmvz.supabase.co`, publishable key `sb_publishable_rwZJ0CRhnxgsHasMv1qLfg_5h9-9Mif` (aman ditampilkan). Worker memakai **Session pooler** `aws-0-ap-southeast-2.pooler.supabase.com:5432`, user `postgres.nkbnxrjbdwkqmqazkmvz` (password hanya di secret). Storage bucket privat `archive` (arsip immutable). |
| Worker | GitHub Actions `worker-tick.yml` cron `*/15 * * * *` → `python -m app.tick` (menjadwalkan job dari `job_runs`). Input manual `jobs` = daftar job dipisah spasi, format `job:k=v,k=v` (mis. `gw_finalize:gw=8`). Timeout 90 menit. Langkah diagnostik `app/doctor.py`. |
| Workflow lain | `ci.yml` (lint/test), `db-migrate.yml` (hanya bila var `DB_MIGRATE_ENABLED=true`; normalnya migrasi via Supabase CLI lokal), `backup-gdrive.yml` (Minggu 03:00 UTC, rclone → Google Drive; **secret `RCLONE_CONFIG` BELUM diisi** → backup belum aktif). |
| Secrets GitHub (terisi) | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Belum: `RCLONE_CONFIG`, `GEMINI_API_KEY`, `API_FOOTBALL_KEY`, `ODDS_API_KEY`, `GNEWS_API_KEY`. `DATABASE_URL` dengan karakter khusus diperbaiki otomatis (`app/db.py repair_url`). |
| Region | Supabase Sydney, Vercel syd1, runner GitHub di AS → tulis DB secara **batch** (executemany), bukan per baris. |

## 3. Tool lokal & perintah penting (Windows, Git Bash)

- uv: `/c/Users/alfia/AppData/Local/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uv.exe`
  (tidak ada `python` global; pakai `uv run python ...`, untuk skrip non-proyek `uv run --no-project python`).
- pnpm/npx: tambahkan `/c/Users/alfia/AppData/Roaming/npm` ke PATH.
- Worker: `cd services/worker && uv run ruff check . && uv run ruff format app tests && uv run mypy app && uv run pytest -q`
  (107 test lolos). `PYTHONIOENCODING=utf-8` untuk output non-ASCII. Batas baris ruff 110.
- Web: `cd apps/web && pnpm -s typecheck && pnpm -s lint` (tidak ada test runner web; logika murni diuji ad-hoc
  dengan `node --experimental-strip-types` di scratchpad).
- Supabase CLI (sudah login & ter-link): dari root repo `node_modules/.bin/supabase db query --linked "<sql>"`;
  migrasi `node_modules/.bin/supabase db push --linked --yes` (HANYA setelah "next").
- Postgres lokal untuk uji end-to-end: harness pgserver
  `C:/Users/alfia/AppData/Local/Temp/claude/D--Claude-Project-Taktik-FPL/a735dfc6-6cfa-433a-849b-1899e89e376e/scratchpad/pgenv/harness.py <repo> <datadir>`
  (jalankan `uv run --with pgserver python harness.py ...`, gunakan datadir baru; mencetak URI).
  Lalu `DATABASE_URL=postgresql+psycopg://postgres:@127.0.0.1:<port>/taktik ARCHIVE_BACKEND=local ARCHIVE_DIR=<dir> uv run python -m app.cli <jobs>`.
- **Backtest offline Model Lab** (tanpa DB, untuk tuning model): dari root `bash services/worker/scripts/lab_offline/export.sh`
  (CSV ke `.data/`, gitignored), lalu dari `services/worker`:
  `uv run python -m scripts.lab_offline.offline 2019/20,2020/21,2021/22,2022/23,2023/24,2024/25,2025/26 season_ppg,points_plus [--cand file.py]`
  (hanya model baseline; ±1 menit untuk 7 musim, cache bundle di `.data/cache`).
- Next.js 16: baca `node_modules/next/dist/docs` sebelum menulis kode web (API berubah dari versi lama).

## 4. MCP & tool Claude yang dipakai

- **codebase-memory-mcp** (user MCP, stdio, aktif): graf kode repo (`search_graph`, `trace_path`, `get_code_snippet`,
  `query_graph`); hook di `~/.claude/settings.json` (PreToolUse Grep/Glob/Bash, PostToolUse Read, SessionStart).
  Repo sudah diindeks; indeks auto-refresh.
- **Browser bawaan (Claude_Browser)**: verifikasi halaman produksi (`navigate`, `get_page_text`, `find`, `javascript_tool`).
- **scheduled-tasks** tersedia (belum dipakai).
- Konektor claude.ai yang **dimatikan** atas permintaan pengguna (hemat konteks): Gmail, Google Calendar, Google Drive,
  Zoom, Tactiq, Claude Docs, visualize. Skill plugin (sentry-skills, last30days, dll.) hanya bisa dimatikan pengguna
  di pengaturan Plugins aplikasi.
- Memori Claude: `C:\Users\alfia\.claude\projects\D--Claude-Project-Taktik-FPL\memory\` (`MEMORY.md`,
  `project-state.md`, `user-preferences.md`).

## 5. Database (21 migrasi; `20261021000500_manager_sources` = managers.wikidata_id/photo_url — cek sudah di-push)

`supabase/migrations/`: base, master (teams/players/external ids/unmatched_entities), calendar (seasons, gameweeks,
fixtures — kolom `understat_match_id`), match_data (lineups, player_match_stats, team_match_stats, match_events,
shots), fpl (fpl_scoring_rules, player_fpl_gw_stats, status & price snapshots), features (player_archetypes,
player_form_features, team_style_profiles, manager_profiles, matchup_edges, fixture_context), market_news, users,
model_reco (model_runs, projections, model_evaluations, evidence, analysis_reports, recommendations), ops (job_runs,
api_usage, app_config, raw_payloads, ai_cache), views (v_player_current, v_next_gw_fixtures, v_player_form, …), rls,
realtime, storage, form_view, archive (data_archives), `20261021000100_history_features`,
`20261021000200_explicit_grants`, `20261021000300_public_read` (anon boleh baca data FPL/analisis),
`20261021000400_season_plan` (fpl_chips, fpl_game_settings, report_type `season_plan`).

Isi produksi: 668 pemain musim 2026/27, 11 musim riwayat FPL (vaastav 2016/17–2025/26, ±258 ribu baris
`player_fpl_gw_stats`), Understat 2025/26 + 2026/27 (450 laga, 13.646 baris pemain, ±11.456 tembakan, PPDA per tim per
laga), aturan poin (40) & chip (8) dari bootstrap. Tabel admin (`app_config`, `job_runs`) tidak terbaca anon.

Kunci penyimpanan penting:
- `analysis_reports`: `weekly_draft` (content `kind=optimal_squad` + `best_xi` 15 pemain dengan bench),
  `season_plan` (snapshot permanen satu per GW, `model_run_id` null).
- `projections.component_breakdown`: komponen v1 (`c_*`, `p60`, `p_goal`, `p_assist`, `p_cs`, `lam_team/opp`,
  `att_mult`, `team_cs`, `style_mult`, `opp_style`…), `reasons` (di baris laga pertama GW terdekat), `gw`, `home`;
  bila model aktif bukan v1: `model`, `v1_xpts`.
- `model_runs.notes`: `first_gw`, `horizon_gw`, `active_model`, `active_info`.
- `model_evaluations`: `xpts-v1-backtest`/`baseline-last4` (evaluate_model) dan `lab:<model>` (Model Lab;
  metric mae_xpts, rmse_xpts, spearman, top10_actual_avg, n_players, fh_points, sim_points, sim_total, sim_hits;
  `detail` berisi season/gw dan meta model) + `lab:weights` (bobot ensemble).
- `player_form_features` window `last4/last8/season` (form) dan `tactical` (profil taktik); `team_style_profiles`
  window `last19`.
- `app_config`: `active_model` (`{"name": "auto"}` saat ini), `lab_ensemble_weights`.

## 6. Worker (`services/worker/app`)

Jadwal tick (`app/tick.py`): `sync_bootstrap` tiap 30 menit (tiap tick dalam 24 jam sebelum deadline),
`sync_fixtures` 15 menit, `poll_event_status` 30 menit, checkpoint deadline T-48j/T-24j/T-6j/T-2j/T-60m/T-15m
(`deadline_checkpoint` → sync + `run_projections` run_type tN; t60 disimpan permanen). Harian (UTC):
`cleanup_retention` 03, `sync_managers` 04 (pelatih dari Wikidata), `sync_player_history` 05 → `build_form` → `run_projections`, `sync_understat` 06,
`evaluate_model` 07, `model_lab` 08 (`only_new`: hanya bila ada GW selesai baru). **Follow-up**: bila
`sync_bootstrap` menemukan perubahan status/berita pemain → `run_projections` ulang (maks tiap 30 menit).

Jobs (`app/jobs/`): sync_bootstrap (pemain/tim/GW/harga/status, aturan poin, chip & game_settings, arsip),
sync_fixtures (+ deteksi perubahan jadwal), poll_event_status, sync_player_history, build_form (label form:
panas/bagus/stabil/menurun/dingin/minim_menit), backfill_history (vaastav), gw_finalize, deadline_checkpoint,
cleanup_retention, run_projections, evaluate_model, sync_understat, sync_managers, model_lab, set_active_model.
CLI manual: `python -m app.cli job[:k=v,...] ...`.

Sumber (`app/sources/`): `fpl.py` (API publik, tanpa login), `vaastav.py` (dataset historis), `understat.py`
(endpoint JSON `getLeagueData/EPL/{tahun}`, `getMatchData/{id}`; 1 req/2 dtk; tim dicocokkan via jadwal, pemain via
nama fuzzy + menit, fallback pemain pindah klub; arsip harian/per laga). Semua lewat `sources/base.py`
(rate-limit, retry tenacity, raw_payloads, api_usage).

Model & optimasi:
- `models/xpts_v1.py` + `models/engine.py`: xPts per komponen (menit, gol, assist, CS, kebobolan, save, bonus,
  defcon, kartu) dari rate pemain ter-shrink (`features/rates.py`, 30 penampilan, prior 450 menit) × kekuatan
  tim (19 laga, xG) × kandang; peluang main dari status/chance; pengali gaya lawan (`features/tactics.py`,
  hanya vs low block/high press, prior 8 laga, batas −15%..+20%). Parameter varian: `last_apps`,
  `xmins_matches`, `prior_min`, `tactics`, `fixture_power`.
- `models/reasons.py`: alasan template berangka (cedera %, DGW/blank, laga mudah/sulit, % gol/assist, defcon,
  low block/high press + PPDA, peran per posisi Understat, form + persentil, rangkaian 5 laga, menit).
- `optimize/squad.py`: ILP PuLP 4 + HiGHS (`prob.add_variable`, `pulp.HiGHS(msg=False,timeLimit=60)`),
  `optimize_squad` (£100m, 2-5-5-3, maks 3/klub) dan `best_xi` (squad 15 untuk 1 GW + bench urutan FPL).
- `optimize/season.py`: rencana musim — XI/bench/kapten per GW untuk squad acuan, Free Hit (ILP per GW),
  Wildcard (squad 6 GW terbaik − squad acuan − nilai free transfer), DGW/BGW, GW terbaik tiap chip dalam
  jendelanya; matriks xPts semua GW tersisa (±53 dtk).
- `lab/`: **Model Lab** — `data.py` (GwBundle point-in-time), `models.py` (13 model: recent4, season_ppg,
  points_plus, fpl_xp [benchmark only], form_fdr, v1, v1_tactics, hot_form, fixture_chaser, minutes_first,
  crowd, ensemble_mean, ensemble_stack [NNLS dari GW sebelumnya]), `simulate.py` (weekly Free Hit; season sim:
  £100m, 1 FT/minggu maks 5, hit −4 bila gain > 5, kapten, autosub; tanpa chip; harga jual = harga kini),
  `live.py` (model aktif: `app_config.active_model` = nama | `auto` = juara season sim musim terbaru ≥10 GW,
  benchmark dikecualikan; fallback tercatat ke v1_tactics).

## 7. Web (`apps/web/src/app`) — https://taktik-fpl.vercel.app

`/` Home (overview GW, **Best XI** 15 pemain + bench + alasan + "Full breakdown"), `/analisis` (harga & transfer,
**Model accuracy**), `/jadwal` (fixtures, FDR, perubahan jadwal), `/pemain/[id]` (hero, poin per GW, form,
**Positions played** (lapangan ala FM dari slot posisi lineup Understat, mulai 2025/26: apps, %, G/A, xG/xA per
posisi), **Detailed stats** (total, per 90, persentil vs posisi sama), **Compare** (tabel pemain se-posisi,
bisa diurutkan), **Upcoming fixtures** (kesulitan 1–5 per lawan + alasan fundamental/teknis: kekuatan & form
lawan, kandang, gaya lawan vs split pemain, duel zona vs pemain lawan di sisi berhadapan), avg poin per posisi,
posisi per laga GW1→38, **Tactical profile**, statistik; nama pemain di Home/Plan bisa diklik), `/klub/[id]`
(profil klub: XI utama & formasi dari lineup, "How they play", pelatih (Wikidata), rekor overall/home/away,
next/last matches, **Match reviews** dengan vonis xG & alasan). Analisis = fungsi murni di `lib/analysis/*`
(deterministik, angka dari data; bukan LLM). Nama klub di seluruh UI → `/klub/[id]`, `/tim` (My Team: mode **Start a new team** vs **I already have a team** —
Team ID via cookie `tfpl_entry`, squad dari API FPL server-side, rencana transfer multi-transfer dengan
estimasi free transfer `?ft=` & hit −4, kapten, catatan Hold/Sell, Wildcard), `/rencana` (Season Plan: kartu chip
per jendela untuk squad pengguna/acuan, tabel GW-per-GW, Weekly baseline), `/model` (Model Lab: leaderboard per
musim, grafik kumulatif SVG, bobot ensemble, model aktif), `/pengaturan` (nama, tema, profil risiko — cookie),
`/admin` (health). `/live` belum dibuat (nav "coming soon"). Data via Supabase anon (`lib/data/*.ts`), API FPL via
`lib/fpl.ts` (server-only). Grafik = SVG inline (tanpa library). Tipe DB tulisan tangan di `lib/database.types.ts`
(tambah tabel baru di sana).

## 8. Hasil & temuan model (penting untuk keputusan berikutnya)

Model Lab 2025/26 (GW4–38, 35 GW) season sim: FPL xP 2015 (benchmark; data bocor/83% nol), **Season PPG 1994
(juara → model aktif via auto)**, Hot form 1908, Ensemble learned 1890, Ensemble mean/Minutes first 1881,
Crowd 1843, v1+tactics 1806, Form×fixture 1793, v1 1766, Fixture chaser 1725, Recent points 1720.
MAE terbaik Season PPG 1.77 vs v1 1.95. **v1 kalah dari baseline sederhana** → prioritas perbaikan.
**Points+** (0.19.0, backtest offline): 2025/26 season sim 2024 (> Season PPG 1994); 7 musim 2019/20–2025/26
+865 sim & +1008 Free Hit vs Season PPG, menang 6/7 musim → akan jadi juara `auto` setelah `model_lab` penuh
dijalankan ulang. **v1 disetel** (0.20.0): 2022/23–2025/26 sim 8207 vs Season PPG 7872, FH 8990 vs 8495, Spearman
≈0.54 vs ≈0.48; 2025/26 2042 vs 1994. Kunci: bobot recency (0.95^i, musim lalu ×0.5) + menit harapan terkalibrasi. Pelajaran: poin realisasi per penampilan + prior harga + peluang main dari menit > model
komponen xG; pengali FDR ringan (±10%/tingkat) & kandang ±6% membantu; riwayat musim lalu untuk rate merugikan.
Musim 2026/27 baru 4 GW (Hot form 262 teratas). Catatan: dengan Season PPG, xPts absolut lebih optimis (tanpa
shrinkage; Best XI ±77 vs ±57 di v1) — ranking yang divalidasi, bukan level poin.

## 9. Backlog (belum dikerjakan), kira-kira urut prioritas

1. ~~Model baru yang mengalahkan Season PPG~~ → Points+ (0.19.0); ~~v1 kalah~~ → v1 disetel (0.20.0, recency +
   kalibrasi menit; 4 musim sim 8207 vs 7872). Lanjutan: coba
   pengali komponen v1 (CS untuk DEF/GKP vs serangan) sebagai pengganti FDR tunggal di Points+, atau model
   learned (LightGBM, latih musim sebelumnya) dengan fitur Points+.
2. Kalibrasi Season PPG (shrink ke rata-rata posisi) agar xPts absolut tidak terlalu optimis; atau ensemble
   yang dipelajari ulang secara bergulir lintas musim.
3. Backup Google Drive: isi secret `RCLONE_CONFIG` (workflow sudah ada).
4. Model Lab: tambah chip ke season sim, harga jual FPL asli, uji musim ≤2024/25 dengan aturan poin musim itu
   (simpan scoring rules per musim), lebih banyak varian (Monte Carlo, minutes model, xMins dari lineup Understat).
5. Rencana musim untuk squad pengguna: rangkaian transfer multi-GW (bukan hanya chip), pilihan chip interaktif.
6. Berita & AI (Fase 2 blueprint): RSS/berita cedera + Gemini (AI_TIER free = Flash) untuk ringkasan & ekstraksi,
   output divalidasi Pydantic/Zod, laporan T-60. `GEMINI_API_KEY` belum diisi.
7. Fase 3: `/live` (live poller, Live Match Center), mini-league, notifikasi (Web Push/Telegram), lineup alert.
8. Fase 4: teammate effects, matchup per zona, what-if simulator, GW review, Sportmonks/API-Football.
9. Fase 5: tema Ember & Pitch, shareable card, aksesibilitas, mode Draft.
10. Opsional: port ke Google AI Studio (Vite SPA yang membaca Supabase langsung); worker tetap di GitHub Actions.

## 10. Checklist saat mulai sesi baru

1. Baca file ini + `MEMORY.md`. Cek `git status` / `git log origin/main..HEAD` (commit lokal belum di-push?).
2. Cek kesehatan produksi: `node_modules/.bin/supabase db query --linked "select job_name,status,max(finished_at) from public.job_runs group by 1,2 order by 3 desc limit 20"`.
3. Sebelum push/migrasi minta **"next"**; setelah push, beri perintah workflow terpisah.
4. Setelah fitur selesai: test + lint + typecheck, update `CHANGELOG.md`, update docs/TaktikFPL.md bila arsitektur berubah.
