# TaktikFPL — Blueprint Database & Infrastruktur

> **Dokumen eksekusi** untuk Claude Code: membangun seluruh database (Supabase/PostgreSQL) dan infrastruktur (monorepo, worker, web, CI/CD, deploy) TaktikFPL dari nol sampai jalan end-to-end.
>
> - Versi: `v1.0` — 20 Oktober 2026
> - Pasangan dokumen: `docs/BLUEPRINT.md` (spesifikasi produk & analisis). Untuk database dan infrastruktur, **dokumen ini yang berlaku** jika ada perbedaan.
> - Repo: `Wafflesgh/TaktikFPL` (saat ini **publik** — lihat aturan secret di Bagian 9)

---

## Daftar Isi

0. [Prompt untuk Claude Code](#0-prompt-untuk-claude-code)
1. [Keputusan Infrastruktur](#1-keputusan-infrastruktur)
2. [Topologi & Diagram](#2-topologi--diagram)
3. [Struktur Monorepo](#3-struktur-monorepo)
4. [Model Data (ERD per Domain)](#4-model-data-erd-per-domain)
5. [Migrasi Database Supabase (SQL Lengkap)](#5-migrasi-database-supabase-sql-lengkap)
6. [Seed & Test Database](#6-seed--test-database)
7. [Worker (Python) — Kerangka Infrastruktur](#7-worker-python--kerangka-infrastruktur)
8. [Web (Next.js) — Kerangka Infrastruktur](#8-web-nextjs--kerangka-infrastruktur)
9. [Environment & Secret Matrix](#9-environment--secret-matrix)
10. [Docker, CI/CD & Deploy](#10-docker-cicd--deploy)
11. [Operasional: Retensi, Backup, Monitoring, Biaya](#11-operasional-retensi-backup-monitoring-biaya)
12. [Langkah Eksekusi untuk Claude Code](#12-langkah-eksekusi-untuk-claude-code)
13. [Definition of Done](#13-definition-of-done)

---

## 0. Prompt untuk Claude Code

Jalankan Claude Code di root repo, lalu kirim:

```text
Baca CLAUDE.md, docs/BLUEPRINT.md, dan docs/INFRA_BLUEPRINT.md.
Kerjakan Bagian 12 dari docs/INFRA_BLUEPRINT.md secara berurutan, Langkah 1 sampai 12.
Aturan:
- Salin isi file (SQL, YAML, TOML, Dockerfile) PERSIS dari blueprint; jika harus mengubah,
  jelaskan alasannya di CHANGELOG.md.
- Setelah tiap langkah, jalankan perintah verifikasi yang tertulis dan laporkan hasilnya.
- Berhenti dan tanya saya sebelum: (a) menjalankan apa pun ke database PRODUKSI
  (supabase db push), (b) membuat resource berbayar, (c) membutuhkan secret yang belum ada di .env.
- Jangan pernah menulis secret ke file yang ter-commit. Repo ini publik.
```

---

## 1. Keputusan Infrastruktur

| Area | Keputusan | Alasan |
|---|---|---|
| Database | **Supabase Postgres** (versi mengikuti project, 15+; SQL di sini kompatibel 15/16/17) | Sudah dibuat; Auth, Realtime, Storage dalam satu paket |
| Migrasi | **Supabase CLI** (`supabase/migrations/*.sql`) sebagai satu-satunya sumber skema | SQL murni, bisa diuji lokal (`supabase start`), deploy dengan `supabase db push`. **Menggantikan Alembic** yang disebut di BLUEPRINT.md |
| Model ORM worker | SQLAlchemy 2 Core/ORM yang **mengikuti** skema (bukan membuat skema) | Hindari dua sumber kebenaran |
| Monorepo | pnpm workspace (`apps/web`) + uv (`services/worker`) | Satu repo, dua runtime |
| Web | Next.js (App Router) di **Vercel** | PWA, gratis untuk proyek pribadi |
| Worker | FastAPI + APScheduler di **Railway** (1 instance always-on, Docker) | Scheduler butuh proses yang terus hidup |
| Koneksi DB worker | **Session pooler** Supabase (port 5432, IPv4) | Direct connection hanya IPv6; session mode mendukung advisory lock untuk leader election |
| Cache/lock/pubsub | **Upstash Redis** (lokal: Redis di Docker) | Cache API, rate limit, broadcast live |
| Live ke browser | Supabase **Realtime** (postgres_changes untuk fixture/berita/notifikasi) + **Broadcast** untuk poin live | Tanpa server WebSocket sendiri |
| Auth | Supabase Auth, **magic link email**; pendaftaran ditutup setelah akun Dilan dibuat | Aplikasi pribadi |
| Keamanan data | **RLS aktif di semua tabel `public`** (dicek otomatis di migrasi) | Wajib karena publishable key ada di browser |
| CI/CD | GitHub Actions: secret scan (gitleaks), test DB (pgTAP), test worker & web; migrasi produksi lewat workflow manual-approval | Repo publik + DB produksi harus terlindungi |

---

## 2. Topologi & Diagram

### 2.1 Produksi

```mermaid
flowchart TB
    subgraph USER["Perangkat Dilan"]
        PHONE["HP (PWA terinstal)"]
        PC["PC (browser)"]
    end

    subgraph VERCEL["Vercel"]
        WEB["apps/web<br/>Next.js App Router<br/>Route Handlers"]
    end

    subgraph RAILWAY["Railway (1 instance)"]
        WK["services/worker<br/>FastAPI :PORT"]
        SCH["APScheduler<br/>(leader via advisory lock)"]
        LIVE["Live poller"]
    end

    subgraph SUPA["Supabase project"]
        AUTH["Auth (magic link)"]
        PG[("Postgres<br/>schema public + scheduler")]
        RT["Realtime<br/>postgres_changes + broadcast"]
        STO["Storage<br/>player-photos, exports"]
        POOL["Supavisor<br/>Session pooler :5432"]
    end

    REDIS[("Upstash Redis")]

    subgraph EXT["API eksternal"]
        FPL["FPL API"]
        APIF["API-Football"]
        UND["Understat"]
        ODDS["The Odds API"]
        NEWS["RSS / GNews"]
        GEM["Gemini API"]
        WX["Open-Meteo"]
    end

    PHONE --> WEB
    PC --> WEB
    PHONE -. realtime .-> RT
    PC -. realtime .-> RT
    WEB -->|supabase-js + JWT user| PG
    WEB -->|JWT user| WK
    WEB --> AUTH
    WK --> POOL --> PG
    SCH --> POOL
    LIVE --> REDIS
    LIVE -->|broadcast| RT
    WK --> REDIS
    WK --> STO
    WK --> EXT
    PG --> RT
```

### 2.2 Lokal (development)

```mermaid
flowchart LR
    subgraph DOCKER["Docker di laptop"]
        SBL["supabase start<br/>API :54321 · DB :54322 · Studio :54323 · Mailpit :54324"]
        RDS["redis :6379<br/>(docker compose)"]
    end
    WEBD["pnpm dev (web) :3000"] --> SBL
    WKD["uv run uvicorn (worker) :8000"] --> SBL
    WKD --> RDS
    WEBD --> WKD
```

### 2.3 Alur migrasi & deploy

```mermaid
flowchart LR
    A["Ubah / tambah file<br/>supabase/migrations"] --> B["supabase db reset<br/>(lokal)"]
    B --> C["supabase test db<br/>(pgTAP)"]
    C --> D["git push → PR"]
    D --> E["CI: gitleaks + DB test + worker test + web build"]
    E --> F["merge ke main"]
    F --> G["Workflow 'db-migrate'<br/>menunggu approval (environment: production)"]
    G --> H["supabase db push → Supabase produksi"]
    F --> I["Railway auto-deploy worker<br/>(watch services/worker/**)"]
    F --> J["Vercel auto-deploy web<br/>(root apps/web)"]
```

### 2.4 Leader election scheduler

```mermaid
sequenceDiagram
    autonumber
    participant W1 as Worker instance A
    participant W2 as Worker instance B (mis. saat redeploy)
    participant PG as Postgres (Session pooler)

    W1->>PG: SELECT pg_try_advisory_lock(hashtext('taktikfpl:scheduler'))
    PG-->>W1: true → A menjadi leader, start APScheduler
    W2->>PG: SELECT pg_try_advisory_lock(...)
    PG-->>W2: false → B hanya melayani HTTP, cek ulang tiap 30 detik
    Note over W1: A mati / deploy selesai → koneksi tutup → lock lepas
    W2->>PG: pg_try_advisory_lock(...)
    PG-->>W2: true → B menjadi leader
```

> Advisory lock level sesi **hanya** aman lewat Session pooler (5432) atau direct connection. Jangan gunakan Transaction pooler (6543) untuk koneksi leader.

---

## 3. Struktur Monorepo

```text
TaktikFPL/
├── CLAUDE.md
├── README.md
├── CHANGELOG.md
├── .env.example
├── .gitignore
├── .gitleaks.toml
├── package.json                    # skrip root + supabase CLI (devDependency)
├── pnpm-workspace.yaml
├── docker-compose.yml              # redis (+ worker opsional)
├── railway.toml
├── docs/
│   ├── BLUEPRINT.md
│   ├── INFRA_BLUEPRINT.md          # dokumen ini
│   └── design/                     # referensi UI
├── supabase/
│   ├── config.toml                 # dibuat `supabase init`, lalu disesuaikan (Bagian 12, Langkah 3)
│   ├── migrations/
│   │   ├── 20261020000100_base.sql
│   │   ├── 20261020000200_master.sql
│   │   ├── 20261020000300_calendar.sql
│   │   ├── 20261020000400_match_data.sql
│   │   ├── 20261020000500_fpl.sql
│   │   ├── 20261020000600_features.sql
│   │   ├── 20261020000700_market_news.sql
│   │   ├── 20261020000800_users.sql
│   │   ├── 20261020000900_model_reco.sql
│   │   ├── 20261020001000_ops.sql
│   │   ├── 20261020001100_views.sql
│   │   ├── 20261020001200_rls.sql
│   │   ├── 20261020001300_realtime.sql
│   │   └── 20261020001400_storage.sql
│   ├── seed.sql
│   └── tests/
│       └── 001_rls_test.sql
├── apps/
│   └── web/                        # Next.js (Bagian 8)
├── services/
│   └── worker/                     # Python (Bagian 7)
│       ├── Dockerfile
│       ├── pyproject.toml
│       ├── uv.lock
│       ├── app/
│       └── tests/
└── .github/
    └── workflows/
        ├── ci.yml
        └── db-migrate.yml
```

---

## 4. Model Data (ERD per Domain)

Total **56 tabel** dalam 9 domain + 4 view. Diagram dibagi per domain agar terbaca.

### 4.1 Master & kalender

```mermaid
erDiagram
    seasons ||--o{ gameweeks : contains
    seasons ||--o{ team_seasons : registers
    seasons ||--o{ player_seasons : registers
    teams ||--o{ team_seasons : plays_in
    teams ||--o{ team_external_ids : mapped_by
    teams ||--o{ manager_tenures : employs
    managers ||--o{ manager_tenures : holds
    players ||--o{ player_seasons : plays_for
    players ||--o{ player_external_ids : mapped_by
    teams ||--o{ player_seasons : squad
    competitions ||--o{ fixtures : hosts
    gameweeks ||--o{ fixtures : schedules
    teams ||--o{ fixtures : home_or_away
    referees ||--o{ fixtures : officiates
    fixtures ||--o{ fixture_changes : history
    fixtures ||--o| fixture_conditions : weather

    fixtures {
        bigint id PK
        int gameweek_id FK
        bigint home_team_id FK
        bigint away_team_id FK
        timestamptz kickoff_utc
        text status
        int fpl_fixture_id
        bigint api_football_fixture_id
    }
    fixture_changes {
        bigint id PK
        bigint fixture_id FK
        text change_type
        jsonb old_value
        jsonb new_value
    }
```

### 4.2 Data pertandingan & FPL

```mermaid
erDiagram
    fixtures ||--o{ lineups : has
    fixtures ||--o{ player_match_stats : produces
    fixtures ||--o{ team_match_stats : produces
    fixtures ||--o{ match_events : produces
    fixtures ||--o{ shots : produces
    players ||--o{ lineups : listed
    players ||--o{ player_match_stats : records
    players ||--o{ shots : takes
    players ||--o{ player_fpl_gw_stats : scores
    gameweeks ||--o{ player_fpl_gw_stats : period
    players ||--o{ player_status_snapshots : status
    players ||--o{ price_snapshots : priced
    players ||--o{ set_piece_roles : takes_set_pieces
    seasons ||--o{ fpl_scoring_rules : defines

    player_fpl_gw_stats {
        bigint player_id PK
        bigint fixture_id PK
        int total_points
        int bps
        int defensive_contribution
        boolean is_final
    }
```

### 4.3 Fitur analitik, pasar & berita

```mermaid
erDiagram
    players ||--o{ player_archetypes : classified
    players ||--o{ player_form_features : form
    teams ||--o{ team_style_profiles : tactical_profile
    managers ||--o{ manager_profiles : coaching_profile
    players ||--o{ teammate_effects : effect_of
    fixtures ||--o{ matchup_edges : matchup
    fixtures ||--o{ fixture_context : context
    fixtures ||--o{ odds_snapshots : priced
    news_items ||--o{ news_entities : mentions
    players ||--o{ news_entities : about
```

### 4.4 Model, rekomendasi, pengguna & operasional

```mermaid
erDiagram
    gameweeks ||--o{ model_runs : runs
    model_runs ||--o{ projections : generates
    players ||--o{ projections : projected
    fixtures ||--o{ projections : per_fixture
    gameweeks ||--o{ analysis_reports : reports
    analysis_reports ||--o{ recommendations : contains
    recommendations ||--o{ recommendation_reasons : explained_by
    evidence ||--o{ recommendation_reasons : supports
    users ||--o{ recommendations : personalised
    users ||--o{ user_fpl_entries : owns
    user_fpl_entries ||--o{ user_squad_picks : picks
    user_fpl_entries ||--o{ user_transfer_plans : plans
    users ||--o{ user_watchlist : watches
    users ||--o{ notifications : receives
    users ||--o{ push_subscriptions : devices
    gameweeks ||--o{ model_evaluations : evaluated

    users {
        uuid id PK
        text timezone
        text theme
        text risk_profile
        boolean is_admin
    }
```

Tabel operasional tanpa relasi: `raw_payloads`, `job_runs`, `app_config`, `api_usage`, `ai_runs`, `ai_cache`, `unmatched_entities`.

---

## 5. Migrasi Database Supabase (SQL Lengkap)

Aturan umum:
- Semua waktu `timestamptz` (UTC). Tampilan WIB dilakukan di aplikasi.
- Tabel ditulis dengan prefix schema `public.` agar tidak bergantung `search_path`.
- Fungsi memakai `set search_path = ''` (sesuai Security Advisor Supabase).
- View memakai `security_invoker = true` agar tetap tunduk pada RLS.
- Worker menulis memakai role `postgres` (lewat pooler) yang memiliki tabel, sehingga **tidak terhalang RLS**. Browser hanya membaca, dibatasi policy.

### 5.1 `supabase/migrations/20261020000100_base.sql`

```sql
-- Extensions (di Supabase, schema "extensions" sudah tersedia)
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Schema khusus jobstore APScheduler. Hanya worker (role postgres) yang memakai.
create schema if not exists scheduler;
revoke all on schema scheduler from public;

-- Trigger umum untuk kolom updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
```

### 5.2 `supabase/migrations/20261020000200_master.sql`

```sql
create table public.seasons (
  id          serial primary key,
  label       text not null unique,                 -- '2026/27'
  start_date  date not null,
  end_date    date,                                 -- diisi dari data FPL saat tersedia
  is_current  boolean not null default false
);
create unique index seasons_single_current on public.seasons (is_current) where is_current;

create table public.competitions (
  id      serial primary key,
  code    text not null unique,                     -- PL, UCL, UEL, UECL, FAC, EFLC, CHAMP
  name    text not null,
  weight  numeric(4,2) not null default 1.0,        -- bobot analisis lintas kompetisi
  is_cup  boolean not null default false
);

create table public.teams (
  id               bigserial primary key,
  name             text not null,
  short_name       text,
  country          text,
  fpl_team_code    int unique,                      -- 'code' dari bootstrap-static (untuk badge)
  stadium_name     text,
  stadium_lat      numeric(9,6),
  stadium_lon      numeric(9,6),
  primary_color    text,
  secondary_color  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger teams_set_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

create table public.team_external_ids (
  team_id      bigint not null references public.teams(id) on delete cascade,
  source       text   not null,                     -- fpl | api_football | understat | sportmonks | clubelo | odds_api
  external_id  text   not null,
  primary key (source, external_id)
);
create index team_external_ids_team_idx on public.team_external_ids (team_id);

create table public.team_seasons (
  team_id      bigint not null references public.teams(id) on delete cascade,
  season_id    int    not null references public.seasons(id) on delete cascade,
  fpl_team_id  int,                                 -- 1..20 musim tsb
  league_code  text   not null default 'PL',
  is_promoted  boolean not null default false,
  primary key (team_id, season_id)
);
create unique index team_seasons_fpl_id_uniq on public.team_seasons (season_id, fpl_team_id)
  where fpl_team_id is not null;

create table public.managers (
  id               bigserial primary key,
  full_name        text not null,
  nationality      text,
  birth_date       date,
  api_football_id  int unique,
  created_at       timestamptz not null default now()
);

create table public.manager_tenures (
  id          bigserial primary key,
  manager_id  bigint not null references public.managers(id) on delete cascade,
  team_id     bigint not null references public.teams(id) on delete cascade,
  start_date  date   not null,
  end_date    date,                                 -- null = masih menjabat
  role        text   not null default 'head_coach' check (role in ('head_coach','interim','caretaker')),
  source_url  text
);
create index manager_tenures_team_idx on public.manager_tenures (team_id, start_date desc);
create unique index manager_tenures_one_active on public.manager_tenures (team_id)
  where end_date is null and role <> 'caretaker';

create table public.players (
  id                  bigserial primary key,
  full_name           text not null,
  web_name            text not null,
  birth_date          date,
  nationality         text,
  preferred_foot      text check (preferred_foot in ('left','right','both')),
  height_cm           int,
  fpl_code            int unique,                   -- 'code' dari bootstrap-static (foto)
  photo_file          text,                         -- 'photo' dari bootstrap-static
  photo_url_resolved  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index players_full_name_trgm on public.players using gin (full_name extensions.gin_trgm_ops);
create index players_web_name_trgm  on public.players using gin (web_name extensions.gin_trgm_ops);
create trigger players_set_updated_at before update on public.players
  for each row execute function public.set_updated_at();

create table public.player_external_ids (
  player_id         bigint not null references public.players(id) on delete cascade,
  source            text   not null,
  external_id       text   not null,
  match_confidence  numeric(3,2) not null default 1.0,
  primary key (source, external_id)
);
create index player_external_ids_player_idx on public.player_external_ids (player_id);

create table public.player_seasons (
  player_id       bigint not null references public.players(id) on delete cascade,
  season_id       int    not null references public.seasons(id) on delete cascade,
  team_id         bigint not null references public.teams(id),
  fpl_element_id  int,                              -- id pemain FPL musim tsb
  fpl_position    text check (fpl_position in ('GKP','DEF','MID','FWD')),
  real_position   text,                             -- RW, LCB, DM, ...
  shirt_number    int,
  joined_on       date,
  left_on         date,
  primary key (player_id, season_id, team_id)
);
create unique index player_seasons_fpl_element_uniq on public.player_seasons (season_id, fpl_element_id)
  where fpl_element_id is not null;
create index player_seasons_team_idx on public.player_seasons (team_id, season_id);

-- Antrean entity matching yang gagal (dicek manual di halaman Admin)
create table public.unmatched_entities (
  id                 bigserial primary key,
  entity_type        text not null check (entity_type in ('player','team','manager','referee')),
  source             text not null,
  external_id        text not null,
  raw_name           text not null,
  context            jsonb not null default '{}'::jsonb,
  best_candidate_id  bigint,
  best_score         numeric(4,3),
  status             text not null default 'open' check (status in ('open','resolved','ignored')),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  unique (source, entity_type, external_id)
);
```

### 5.3 `supabase/migrations/20261020000300_calendar.sql`

```sql
create table public.gameweeks (
  id               serial primary key,
  season_id        int  not null references public.seasons(id) on delete cascade,
  number           int  not null check (number between 1 and 38),
  fpl_event_id     int,
  deadline_utc     timestamptz not null,
  is_current       boolean not null default false,
  is_next          boolean not null default false,
  is_finished      boolean not null default false,
  bonus_confirmed  boolean not null default false,   -- dari event-status/
  leagues_updated  boolean not null default false,   -- dari event-status/
  scores_final_at  timestamptz,
  is_blank         boolean not null default false,   -- dihitung
  is_double        boolean not null default false,   -- dihitung
  updated_at       timestamptz not null default now(),
  unique (season_id, number)
);
create trigger gameweeks_set_updated_at before update on public.gameweeks
  for each row execute function public.set_updated_at();

create table public.referees (
  id             bigserial primary key,
  name           text not null unique,
  avg_yellow     numeric(4,2),
  avg_red        numeric(4,3),
  avg_penalties  numeric(4,3),
  matches_count  int,
  updated_at     timestamptz not null default now()
);

create table public.fixtures (
  id                       bigserial primary key,
  season_id                int    not null references public.seasons(id),
  competition_id           int    not null references public.competitions(id),
  gameweek_id              int    references public.gameweeks(id),  -- null: non-PL atau laga PL ditunda
  round_label              text,
  home_team_id             bigint not null references public.teams(id),
  away_team_id             bigint not null references public.teams(id),
  kickoff_utc              timestamptz,                             -- null = belum ditentukan
  venue                    text,
  status                   text not null default 'scheduled'
                           check (status in ('scheduled','tbc','live','ht','finished','postponed','cancelled','abandoned')),
  minute                   int,
  home_goals               int,
  away_goals               int,
  referee_id               bigint references public.referees(id),
  fpl_fixture_id           int,
  api_football_fixture_id  bigint unique,
  understat_match_id       bigint,
  difficulty_home          int,
  difficulty_away          int,
  custom_difficulty_home   numeric(4,2),
  custom_difficulty_away   numeric(4,2),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create unique index fixtures_fpl_uniq on public.fixtures (season_id, fpl_fixture_id) where fpl_fixture_id is not null;
create index fixtures_gameweek_idx on public.fixtures (gameweek_id);
create index fixtures_kickoff_idx  on public.fixtures (kickoff_utc);
create index fixtures_home_idx     on public.fixtures (home_team_id, kickoff_utc);
create index fixtures_away_idx     on public.fixtures (away_team_id, kickoff_utc);
create trigger fixtures_set_updated_at before update on public.fixtures
  for each row execute function public.set_updated_at();

create table public.fixture_changes (
  id           bigserial primary key,
  fixture_id   bigint not null references public.fixtures(id) on delete cascade,
  detected_at  timestamptz not null default now(),
  change_type  text not null check (change_type in
               ('kickoff_moved','gameweek_moved','postponed','rescheduled','venue_changed','status_changed','created')),
  old_value    jsonb,
  new_value    jsonb,
  source       text not null,
  reason       text,
  notified     boolean not null default false
);
create index fixture_changes_fixture_idx on public.fixture_changes (fixture_id, detected_at desc);
create index fixture_changes_pending_idx on public.fixture_changes (detected_at) where not notified;

create table public.fixture_conditions (
  fixture_id        bigint primary key references public.fixtures(id) on delete cascade,
  temperature_c     numeric(4,1),
  precipitation_mm  numeric(5,2),
  wind_kph          numeric(5,1),
  condition_label   text,
  fetched_at        timestamptz not null default now()
);
```

### 5.4 `supabase/migrations/20261020000400_match_data.sql`

```sql
create table public.lineups (
  fixture_id      bigint not null references public.fixtures(id) on delete cascade,
  team_id         bigint not null references public.teams(id),
  player_id       bigint not null references public.players(id),
  is_starter      boolean not null,
  formation       text,
  grid_position   text,                 -- 'baris:kolom' dari API-Football
  position_label  text,
  minute_on       int,
  minute_off      int,
  is_confirmed    boolean not null default true,   -- false = prediksi/bocoran
  source          text not null,
  updated_at      timestamptz not null default now(),
  primary key (fixture_id, player_id)
);
create index lineups_player_idx on public.lineups (player_id);

create table public.player_match_stats (
  fixture_id            bigint not null references public.fixtures(id) on delete cascade,
  player_id             bigint not null references public.players(id),
  team_id               bigint not null references public.teams(id),
  source                text   not null,           -- api_football | understat | sportmonks | fpl
  minutes               int,
  goals                 int,
  assists               int,
  shots                 int,
  shots_on_target       int,
  xg                    numeric(6,3),
  npxg                  numeric(6,3),
  xa                    numeric(6,3),
  key_passes            int,
  big_chances_created   int,
  big_chances_missed    int,
  passes                int,
  pass_accuracy         numeric(5,2),
  crosses               int,
  crosses_accurate      int,
  dribbles_attempted    int,
  dribbles_success      int,
  touches               int,
  touches_in_box        int,
  progressive_passes    int,
  progressive_carries   int,
  tackles               int,
  tackles_won           int,
  interceptions         int,
  clearances            int,
  blocks                int,
  recoveries            int,
  duels                 int,
  duels_won             int,
  aerials               int,
  aerials_won           int,
  dribbled_past         int,
  fouls_committed       int,
  fouls_drawn           int,
  yellow_cards          int,
  red_cards             int,
  saves                 int,
  goals_conceded        int,
  penalties_won         int,
  penalties_scored      int,
  penalties_missed      int,
  penalties_saved       int,
  rating                numeric(4,2),
  extra                 jsonb not null default '{}'::jsonb,
  updated_at            timestamptz not null default now(),
  primary key (fixture_id, player_id, source)
);
create index player_match_stats_player_idx on public.player_match_stats (player_id);

create table public.team_match_stats (
  fixture_id        bigint not null references public.fixtures(id) on delete cascade,
  team_id           bigint not null references public.teams(id),
  source            text   not null,
  possession        numeric(5,2),
  xg                numeric(6,3),
  xga               numeric(6,3),
  shots             int,
  shots_on_target   int,
  ppda              numeric(6,2),
  deep_completions  int,
  passes            int,
  pass_accuracy     numeric(5,2),
  corners           int,
  crosses           int,
  fast_break_shots  int,
  set_piece_xg      numeric(6,3),
  extra             jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  primary key (fixture_id, team_id, source)
);

create table public.match_events (
  id                  bigserial primary key,
  fixture_id          bigint not null references public.fixtures(id) on delete cascade,
  source              text   not null,
  external_event_key  text   not null,          -- kunci dedupe dari provider
  minute              int    not null,
  extra_minute        int,
  team_id             bigint references public.teams(id),
  player_id           bigint references public.players(id),
  related_player_id   bigint references public.players(id),
  event_type          text   not null check (event_type in
                      ('goal','own_goal','penalty_goal','penalty_miss','card_yellow','card_red','sub','var','other')),
  detail              text,
  received_at         timestamptz not null default now(),
  unique (fixture_id, source, external_event_key)
);
create index match_events_fixture_idx on public.match_events (fixture_id, minute);

create table public.shots (
  id                bigserial primary key,
  fixture_id        bigint not null references public.fixtures(id) on delete cascade,
  source            text   not null default 'understat',
  external_shot_id  text   not null,
  player_id         bigint references public.players(id),
  team_id           bigint references public.teams(id),
  minute            int,
  x                 numeric(5,3),
  y                 numeric(5,3),
  xg                numeric(6,4),
  result            text,
  situation         text,
  shot_type         text,
  last_action       text,
  assist_player_id  bigint references public.players(id),
  unique (source, external_shot_id)
);
create index shots_player_idx  on public.shots (player_id);
create index shots_fixture_idx on public.shots (fixture_id);
```

### 5.5 `supabase/migrations/20261020000500_fpl.sql`

```sql
create table public.fpl_scoring_rules (
  season_id  int  not null references public.seasons(id) on delete cascade,
  rule_key   text not null,
  value      numeric not null,
  notes      text,
  primary key (season_id, rule_key)
);

create table public.player_fpl_gw_stats (
  player_id                   bigint not null references public.players(id),
  fixture_id                  bigint not null references public.fixtures(id) on delete cascade,
  gameweek_id                 int    not null references public.gameweeks(id),
  minutes                     int,
  total_points                int,
  bonus                       int,
  bps                         int,
  goals_scored                int,
  assists                     int,
  clean_sheets                int,
  goals_conceded              int,
  own_goals                   int,
  penalties_saved             int,
  penalties_missed            int,
  yellow_cards                int,
  red_cards                   int,
  saves                       int,
  defensive_contribution      int,
  defcon_points               int,
  expected_goals              numeric(6,3),
  expected_assists            numeric(6,3),
  expected_goal_involvements  numeric(6,3),
  expected_goals_conceded     numeric(6,3),
  influence                   numeric(6,1),
  creativity                  numeric(6,1),
  threat                      numeric(6,1),
  ict_index                   numeric(6,1),
  value_tenths                int,
  selected                    int,
  is_final                    boolean not null default false,
  updated_at                  timestamptz not null default now(),
  primary key (player_id, fixture_id)
);
create index player_fpl_gw_stats_gw_idx on public.player_fpl_gw_stats (gameweek_id);
create trigger player_fpl_gw_stats_set_updated_at before update on public.player_fpl_gw_stats
  for each row execute function public.set_updated_at();

create table public.player_status_snapshots (
  id              bigserial primary key,
  player_id       bigint not null references public.players(id) on delete cascade,
  captured_at     timestamptz not null default now(),
  status          text,              -- a | d | i | s | u | n
  chance_next     int,
  chance_this     int,
  news            text,
  news_added_utc  timestamptz
);
create index player_status_snapshots_player_idx on public.player_status_snapshots (player_id, captured_at desc);

create table public.price_snapshots (
  player_id              bigint not null references public.players(id) on delete cascade,
  captured_on            date   not null,
  price_tenths           int    not null,
  selected_by_pct        numeric(5,2),
  transfers_in_event     int,
  transfers_out_event    int,
  price_change_progress  numeric(6,2),
  primary key (player_id, captured_on)
);

create table public.set_piece_roles (
  team_id     bigint not null references public.teams(id) on delete cascade,
  season_id   int    not null references public.seasons(id) on delete cascade,
  role        text   not null check (role in ('penalty','direct_fk','indirect_fk','corner_left','corner_right','corner')),
  order_rank  int    not null,
  player_id   bigint not null references public.players(id),
  source      text   not null,      -- fpl_set_piece_notes | news | derived
  note_text   text,
  updated_at  timestamptz not null default now(),
  primary key (team_id, season_id, role, order_rank)
);
```

### 5.6 `supabase/migrations/20261020000600_features.sql`

```sql
create table public.player_archetypes (
  player_id       bigint not null references public.players(id) on delete cascade,
  season_id       int    not null references public.seasons(id) on delete cascade,
  computed_at     timestamptz not null default now(),
  archetype       text   not null,
  membership      numeric(4,3) not null check (membership between 0 and 1),
  is_primary      boolean not null default false,
  feature_vector  jsonb  not null,
  description_id  text,
  confidence      numeric(4,3),
  primary key (player_id, season_id, archetype, computed_at)
);

create table public.player_form_features (
  player_id       bigint not null references public.players(id) on delete cascade,
  as_of           timestamptz not null,
  window_label    text not null,          -- last4 | last8 | season | all_comps_120d
  metrics         jsonb not null,
  sample_minutes  int  not null,
  primary key (player_id, as_of, window_label)
);

create table public.team_style_profiles (
  team_id          bigint not null references public.teams(id) on delete cascade,
  as_of            timestamptz not null,
  window_label     text not null,
  manager_id       bigint references public.managers(id),
  metrics          jsonb not null,
  style_tags       jsonb not null,        -- {"high_press":0.82,"possession":0.71}
  weaknesses       jsonb not null default '{}'::jsonb,
  formation_usage  jsonb,
  narrative_id     text,
  primary key (team_id, as_of, window_label)
);

create table public.manager_profiles (
  manager_id                  bigint not null references public.managers(id) on delete cascade,
  as_of                       timestamptz not null,
  rotation_index              numeric(5,2),
  post_europe_rotation        numeric(5,2),
  minutes_gini                numeric(4,3),
  avg_first_sub_minute        numeric(4,1),
  pct_starters_off_before_60  numeric(4,3),
  early_sub_when_leading      numeric(4,3),
  youth_minutes_share         numeric(4,3),
  preferred_formations        jsonb,
  style_prior                 jsonb,
  narrative_id                text,
  primary key (manager_id, as_of)
);

create table public.teammate_effects (
  player_id        bigint not null references public.players(id) on delete cascade,
  teammate_id      bigint not null references public.players(id) on delete cascade,
  season_scope     text   not null,
  metric           text   not null,       -- xg90 | xa90 | xpts90
  with_value       numeric(8,4),
  without_value    numeric(8,4),
  delta            numeric(8,4),
  ci_low           numeric(8,4),
  ci_high          numeric(8,4),
  minutes_with     int,
  minutes_without  int,
  computed_at      timestamptz not null default now(),
  primary key (player_id, teammate_id, season_scope, metric),
  check (player_id <> teammate_id)
);

create table public.matchup_edges (
  id                  bigserial primary key,
  fixture_id          bigint not null references public.fixtures(id) on delete cascade,
  player_id           bigint not null references public.players(id),
  opponent_player_id  bigint references public.players(id),
  zone                text,                -- left_flank | right_flank | zone14 | box | aerial
  tier                char(1) not null check (tier in ('A','B','C')),
  edge_score          numeric(4,3) not null check (edge_score between -1 and 1),
  sample_minutes      int,
  detail              jsonb,
  computed_at         timestamptz not null default now()
);
create unique index matchup_edges_uniq
  on public.matchup_edges (fixture_id, player_id, coalesce(opponent_player_id, 0), coalesce(zone, ''));

create table public.fixture_context (
  fixture_id             bigint not null references public.fixtures(id) on delete cascade,
  team_id                bigint not null references public.teams(id),
  days_rest              numeric(4,1),
  matches_last_14d       int,
  europe_midweek_before  boolean,
  travel_km_last_match   numeric(7,1),
  style_clash            jsonb,
  h2h_summary            jsonb,
  team_elo               numeric(7,2),
  opp_elo                numeric(7,2),
  is_derby               boolean not null default false,
  computed_at            timestamptz not null default now(),
  primary key (fixture_id, team_id)
);
```

### 5.7 `supabase/migrations/20261020000700_market_news.sql`

```sql
create table public.odds_snapshots (
  id             bigserial primary key,
  fixture_id     bigint not null references public.fixtures(id) on delete cascade,
  captured_at    timestamptz not null default now(),
  bookmaker      text not null,
  market         text not null,       -- h2h | totals | btts | player_goal_scorer_anytime | clean_sheet
  selection      text not null,
  player_id      bigint references public.players(id),
  price_decimal  numeric(8,3) not null check (price_decimal > 1),
  implied_prob   numeric(6,5) not null check (implied_prob between 0 and 1)
);
create index odds_snapshots_fixture_idx on public.odds_snapshots (fixture_id, market, captured_at desc);

create table public.news_items (
  id            bigserial primary key,
  url           text unique,
  source        text not null,        -- bbc_rss | club_site | gnews | gemini_grounding | fpl_news
  title         text,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  raw_text      text,
  lang          text not null default 'en',
  content_hash  text,
  processed     boolean not null default false
);
create index news_items_published_idx   on public.news_items (published_at desc);
create index news_items_unprocessed_idx on public.news_items (fetched_at) where not processed;
create index news_items_hash_idx        on public.news_items (content_hash);

create table public.news_entities (
  id                bigserial primary key,
  news_id           bigint not null references public.news_items(id) on delete cascade,
  player_id         bigint references public.players(id),
  team_id           bigint references public.teams(id),
  manager_id        bigint references public.managers(id),
  signal_type       text not null check (signal_type in
                    ('injury','illness','suspension','rotation_hint','manager_conflict','manager_change',
                     'transfer','return_to_training','lineup_leak','other')),
  severity          text check (severity in ('low','medium','high')),
  expected_absence  text check (expected_absence in ('none','1_match','2_4_weeks','long_term','unknown')),
  confidence        numeric(4,3) check (confidence between 0 and 1),
  summary_id        text,
  extracted_by      text not null,
  created_at        timestamptz not null default now()
);
create index news_entities_player_idx on public.news_entities (player_id, created_at desc);
create index news_entities_team_idx   on public.news_entities (team_id, created_at desc);
```

### 5.8 `supabase/migrations/20261020000800_users.sql`

```sql
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  timezone      text not null default 'Asia/Jakarta',
  locale        text not null default 'id-ID',
  theme         text not null default 'violet' check (theme in ('violet','ember','pitch')),
  risk_profile  text not null default 'balanced' check (risk_profile in ('safe','balanced','aggressive')),
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- Profil otomatis saat akun Auth dibuat. Pengguna pertama otomatis admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    not exists (select 1 from public.users)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper untuk policy admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_admin from public.users u where u.id = (select auth.uid())),
    false
  );
$$;

create table public.user_fpl_entries (
  id               bigserial primary key,
  user_id          uuid not null references public.users(id) on delete cascade,
  fpl_entry_id     int  not null,
  team_name        text,
  is_primary       boolean not null default true,
  mini_league_ids  int[] not null default '{}',
  h2h_league_ids   int[] not null default '{}',
  auth_mode        text not null default 'public' check (auth_mode in ('public','cookie')),
  created_at       timestamptz not null default now(),
  unique (user_id, fpl_entry_id)
);

create table public.user_squad_picks (
  entry_id               bigint not null references public.user_fpl_entries(id) on delete cascade,
  gameweek_id            int    not null references public.gameweeks(id),
  slot                   int    not null check (slot between 1 and 15),
  player_id              bigint not null references public.players(id),
  is_captain             boolean not null default false,
  is_vice                boolean not null default false,
  multiplier             int    not null default 1,
  purchase_price_tenths  int,
  selling_price_tenths   int,
  primary key (entry_id, gameweek_id, slot)
);

create table public.user_transfer_plans (
  id          bigserial primary key,
  user_id     uuid   not null references public.users(id) on delete cascade,
  entry_id    bigint not null references public.user_fpl_entries(id) on delete cascade,
  gameweek_id int    not null references public.gameweeks(id),
  horizon_gw  int    not null default 3 check (horizon_gw between 1 and 8),
  plan        jsonb  not null,          -- daftar transfer, hit, chip, asumsi
  xpts_gain   numeric(6,2),
  status      text   not null default 'draft' check (status in ('draft','applied','discarded')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger user_transfer_plans_set_updated_at before update on public.user_transfer_plans
  for each row execute function public.set_updated_at();

create table public.user_watchlist (
  user_id    uuid   not null references public.users(id) on delete cascade,
  player_id  bigint not null references public.players(id) on delete cascade,
  note       text,
  added_at   timestamptz not null default now(),
  primary key (user_id, player_id)
);

create table public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null check (kind in
              ('injury_alert','fixture_change','deadline_report','price_change','lineup_confirmed',
               'goal','set_piece_change','system')),
  title       text not null,
  body        text,
  payload     jsonb,
  channel     text[] not null default '{push}',
  sent_at     timestamptz,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
```

### 5.9 `supabase/migrations/20261020000900_model_reco.sql`

```sql
create table public.model_runs (
  id             bigserial primary key,
  gameweek_id    int  not null references public.gameweeks(id),
  run_type       text not null check (run_type in ('weekly','t48','t24','t6','t2','t60','t15','adhoc','backtest')),
  model_version  text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running' check (status in ('running','ok','failed','skipped')),
  input_hash     text,
  notes          jsonb
);
create index model_runs_gw_idx on public.model_runs (gameweek_id, finished_at desc);

create table public.projections (
  id                   bigserial primary key,
  model_run_id         bigint not null references public.model_runs(id) on delete cascade,
  player_id            bigint not null references public.players(id),
  fixture_id           bigint not null references public.fixtures(id),
  p_start              numeric(5,4),
  p_60                 numeric(5,4),
  xmins                numeric(5,2),
  xg                   numeric(6,4),
  xa                   numeric(6,4),
  p_goal               numeric(5,4),
  p_assist             numeric(5,4),
  p_cs                 numeric(5,4),
  p_defcon             numeric(5,4),
  xbonus               numeric(5,3),
  xsaves               numeric(5,3),
  xpts                 numeric(6,3) not null,
  p10                  numeric(5,2),
  p50                  numeric(5,2),
  p90                  numeric(5,2),
  p_haul               numeric(5,4),
  p_blank              numeric(5,4),
  component_breakdown  jsonb,
  shap_top             jsonb,
  unique (model_run_id, player_id, fixture_id)
);
create index projections_player_idx  on public.projections (player_id);
create index projections_fixture_idx on public.projections (fixture_id);

create table public.model_evaluations (
  gameweek_id    int  not null references public.gameweeks(id),
  model_version  text not null,
  metric         text not null,
  value          numeric not null,
  detail         jsonb,
  created_at     timestamptz not null default now(),
  primary key (gameweek_id, model_version, metric)
);

create table public.evidence (
  id          bigserial primary key,
  kind        text not null check (kind in ('stat','matchup','teammate','tactic','news','odds','fixture','form','market')),
  ref_table   text,
  ref_key     jsonb,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

create table public.analysis_reports (
  id            bigserial primary key,
  gameweek_id   int    not null references public.gameweeks(id),
  model_run_id  bigint references public.model_runs(id),
  report_type   text   not null check (report_type in
                ('weekly_draft','deadline_t60','player_deep_dive','team_tactics','gw_review','checkpoint')),
  status        text   not null default 'ok' check (status in ('ok','degraded','failed')),
  title         text,
  content_md    text,
  content_json  jsonb,
  ai_model      text,
  created_at    timestamptz not null default now()
);
create index analysis_reports_gw_idx on public.analysis_reports (gameweek_id, report_type, created_at desc);

create table public.recommendations (
  id                bigserial primary key,
  report_id         bigint not null references public.analysis_reports(id) on delete cascade,
  user_id           uuid   references public.users(id) on delete cascade,   -- null = umum
  rec_type          text   not null check (rec_type in
                    ('transfer_in','transfer_out','captain','vice','start','bench','differential','chip')),
  player_id         bigint references public.players(id),
  paired_player_id  bigint references public.players(id),
  rank              int    not null,
  xpts_1gw          numeric(6,3),
  xpts_3gw          numeric(6,3),
  xpts_6gw          numeric(6,3),
  confidence        numeric(4,3),
  one_liner_id      text,
  scenarios         jsonb,
  risk_triggers     jsonb,
  alternatives      jsonb
);
create index recommendations_report_idx on public.recommendations (report_id, rec_type, rank);
create index recommendations_user_idx   on public.recommendations (user_id);

create table public.recommendation_reasons (
  id                 bigserial primary key,
  recommendation_id  bigint not null references public.recommendations(id) on delete cascade,
  category           text   not null check (category in
                     ('form','fixture','matchup','tactic','teammate','news','market','schedule')),
  text_id            text   not null,
  weight             numeric(5,3),
  evidence_id        bigint references public.evidence(id)
);
create index recommendation_reasons_rec_idx on public.recommendation_reasons (recommendation_id);

create table public.ai_runs (
  id              bigserial primary key,
  task            text not null,
  model           text not null,
  prompt_version  text not null,
  input_hash      text,
  input_tokens    int,
  output_tokens   int,
  cost_usd        numeric(10,5),
  latency_ms      int,
  grounded        boolean not null default false,
  status          text not null check (status in ('ok','degraded','failed','cached','skipped_budget')),
  error           text,
  created_at      timestamptz not null default now()
);
create index ai_runs_created_idx on public.ai_runs (created_at desc);

create table public.ai_cache (
  input_hash      text primary key,
  task            text not null,
  model           text not null,
  prompt_version  text not null,
  output          jsonb not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz
);
```

### 5.10 `supabase/migrations/20261020001000_ops.sql`

```sql
create table public.raw_payloads (
  id           bigserial primary key,
  source       text not null,
  endpoint     text not null,
  params       jsonb,
  fetched_at   timestamptz not null default now(),
  status_code  int,
  body         jsonb,
  body_hash    text
);
create index raw_payloads_lookup_idx on public.raw_payloads (source, endpoint, fetched_at desc);
create index raw_payloads_fetched_idx on public.raw_payloads (fetched_at);

create table public.job_runs (
  id             bigserial primary key,
  job_name       text not null,
  scheduled_for  timestamptz,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running' check (status in ('running','ok','failed','skipped')),
  stats          jsonb,
  error          text
);
create index job_runs_name_idx on public.job_runs (job_name, started_at desc);

create table public.app_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
create trigger app_config_set_updated_at before update on public.app_config
  for each row execute function public.set_updated_at();

-- Pemakaian kuota API eksternal per hari (mis. API-Football free tier)
create table public.api_usage (
  source      text not null,
  usage_date  date not null,
  requests    int  not null default 0,
  quota       int,
  updated_at  timestamptz not null default now(),
  primary key (source, usage_date)
);
```

### 5.11 `supabase/migrations/20261020001100_views.sql`

```sql
-- Pemain musim berjalan + status & harga terbaru (dipakai daftar pemain di UI)
create view public.v_player_current
with (security_invoker = true) as
select
  p.id,
  p.web_name,
  p.full_name,
  p.fpl_code,
  p.photo_file,
  p.photo_url_resolved,
  ps.team_id,
  t.short_name        as team_short_name,
  ps.fpl_element_id,
  ps.fpl_position,
  ps.real_position,
  st.status,
  st.chance_next,
  st.news,
  st.captured_at      as status_captured_at,
  pr.price_tenths,
  pr.selected_by_pct
from public.players p
join public.player_seasons ps on ps.player_id = p.id and ps.left_on is null
join public.seasons s         on s.id = ps.season_id and s.is_current
join public.teams t           on t.id = ps.team_id
left join lateral (
  select x.status, x.chance_next, x.news, x.captured_at
  from public.player_status_snapshots x
  where x.player_id = p.id
  order by x.captured_at desc
  limit 1
) st on true
left join lateral (
  select y.price_tenths, y.selected_by_pct
  from public.price_snapshots y
  where y.player_id = p.id
  order by y.captured_on desc
  limit 1
) pr on true;

-- Fixture GW berikutnya + penanda perubahan jadwal 7 hari terakhir
create view public.v_next_gw_fixtures
with (security_invoker = true) as
select
  f.id,
  g.number                                  as gw,
  f.home_team_id,
  ht.short_name                             as home,
  f.away_team_id,
  awt.short_name                            as away,
  f.kickoff_utc,
  (f.kickoff_utc at time zone 'Asia/Jakarta') as kickoff_wib,
  f.status,
  f.difficulty_home,
  f.difficulty_away,
  exists (
    select 1 from public.fixture_changes c
    where c.fixture_id = f.id and c.detected_at > now() - interval '7 days'
  )                                         as recently_changed
from public.fixtures f
join public.gameweeks g on g.id = f.gameweek_id and g.is_next
join public.teams ht    on ht.id = f.home_team_id
join public.teams awt   on awt.id = f.away_team_id;

-- Proyeksi terbaru (run sukses terakhir) per pemain-fixture untuk GW berikutnya
create view public.v_latest_projections
with (security_invoker = true) as
select distinct on (p.player_id, p.fixture_id)
  p.*,
  r.run_type,
  r.finished_at as run_finished_at
from public.projections p
join public.model_runs r on r.id = p.model_run_id and r.status = 'ok'
join public.gameweeks g  on g.id = r.gameweek_id and g.is_next
order by p.player_id, p.fixture_id, r.finished_at desc;

-- Jumlah laga per tim per GW musim berjalan (deteksi Blank/Double GW)
create view public.v_gw_team_fixture_counts
with (security_invoker = true) as
select
  g.id      as gameweek_id,
  g.number  as gw,
  ts.team_id,
  count(f.id) as fixture_count
from public.gameweeks g
join public.seasons s       on s.id = g.season_id and s.is_current
join public.team_seasons ts on ts.season_id = g.season_id and ts.league_code = 'PL'
left join public.fixtures f on f.gameweek_id = g.id
  and (f.home_team_id = ts.team_id or f.away_team_id = ts.team_id)
  and f.status not in ('postponed','cancelled')
group by g.id, g.number, ts.team_id;
```

### 5.12 `supabase/migrations/20261020001200_rls.sql`

```sql
-- 1) Data sepakbola & hasil model: baca untuk pengguna login, tulis hanya worker.
-- 2) Data operasional: baca hanya admin.
-- 3) Data privat worker: tanpa akses dari browser sama sekali.
do $$
declare
  t text;
  reference_tables text[] := array[
    'seasons','competitions','teams','team_external_ids','team_seasons','managers','manager_tenures',
    'players','player_external_ids','player_seasons',
    'gameweeks','referees','fixtures','fixture_changes','fixture_conditions',
    'lineups','player_match_stats','team_match_stats','match_events','shots',
    'fpl_scoring_rules','player_fpl_gw_stats','player_status_snapshots','price_snapshots','set_piece_roles',
    'player_archetypes','player_form_features','team_style_profiles','manager_profiles',
    'teammate_effects','matchup_edges','fixture_context',
    'odds_snapshots','news_items','news_entities',
    'model_runs','projections','model_evaluations','evidence','analysis_reports'
  ];
  admin_tables text[] := array['job_runs','ai_runs','api_usage','unmatched_entities','app_config'];
  private_tables text[] := array['raw_payloads','ai_cache'];
begin
  foreach t in array reference_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select_authenticated', t);
  end loop;

  foreach t in array admin_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_admin()))',
      t || '_select_admin', t);
  end loop;

  foreach t in array private_tables loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- Data milik pengguna
alter table public.users               enable row level security;
alter table public.user_fpl_entries    enable row level security;
alter table public.user_squad_picks    enable row level security;
alter table public.user_transfer_plans enable row level security;
alter table public.user_watchlist      enable row level security;
alter table public.notifications       enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.recommendations     enable row level security;
alter table public.recommendation_reasons enable row level security;

create policy users_select_own on public.users
  for select to authenticated using (id = (select auth.uid()));
create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));   -- kolom is_admin dikunci lewat GRANT kolom di bawah

create policy user_fpl_entries_all_own on public.user_fpl_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_squad_picks_all_own on public.user_squad_picks
  for all to authenticated
  using (exists (select 1 from public.user_fpl_entries e
                 where e.id = entry_id and e.user_id = (select auth.uid())))
  with check (exists (select 1 from public.user_fpl_entries e
                      where e.id = entry_id and e.user_id = (select auth.uid())));

create policy user_transfer_plans_all_own on public.user_transfer_plans
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_watchlist_all_own on public.user_watchlist
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_all_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy recommendations_select_visible on public.recommendations
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy recommendation_reasons_select_visible on public.recommendation_reasons
  for select to authenticated
  using (exists (select 1 from public.recommendations r where r.id = recommendation_id));

-- Kolom pengguna: hanya preferensi yang boleh diubah dari browser
revoke update on public.users from authenticated;
grant update (display_name, timezone, locale, theme, risk_profile) on public.users to authenticated;

-- Pengaman: migrasi gagal jika ada tabel public tanpa RLS
do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS belum aktif di tabel: %', missing;
  end if;
end
$$;
```

> Setiap tabel baru di masa depan wajib ditambahkan ke salah satu daftar di atas (di migrasi baru), atau blok pengaman di migrasi berikutnya akan gagal. Salin blok pengaman ke akhir setiap migrasi yang membuat tabel.

### 5.13 `supabase/migrations/20261020001300_realtime.sql`

```sql
-- Perubahan yang dikirim ke browser lewat Supabase Realtime (postgres_changes).
-- Poin live per pemain TIDAK lewat sini (terlalu sering); worker memakai Realtime Broadcast.
alter publication supabase_realtime add table
  public.fixtures,
  public.fixture_changes,
  public.match_events,
  public.notifications,
  public.analysis_reports,
  public.player_status_snapshots,
  public.gameweeks;
```

### 5.14 `supabase/migrations/20261020001400_storage.sql`

```sql
-- player-photos: cache foto kepala pemain (baca publik, tulis hanya worker)
-- exports: file ekspor pribadi pengguna, folder pertama = user id
insert into storage.buckets (id, name, public)
values
  ('player-photos', 'player-photos', true),
  ('exports',       'exports',       false)
on conflict (id) do nothing;

create policy exports_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
```

---

## 6. Seed & Test Database

### 6.1 `supabase/seed.sql`

Seed hanya berisi data acuan yang stabil. Pemain, tim, GW, dan fixture **tidak** di-seed: semuanya diisi worker dari API (Langkah 9).

```sql
-- Musim berjalan. end_date diisi worker dari data FPL.
insert into public.seasons (label, start_date, is_current)
values ('2026/27', '2026-08-21', true)
on conflict (label) do nothing;

-- Kompetisi & bobot analisis (lihat BLUEPRINT 4.2.2)
insert into public.competitions (code, name, weight, is_cup) values
  ('PL',    'Premier League',          1.00, false),
  ('UCL',   'UEFA Champions League',   0.95, false),
  ('UEL',   'UEFA Europa League',      0.85, false),
  ('UECL',  'UEFA Conference League',  0.75, false),
  ('FAC',   'FA Cup',                  0.70, true),
  ('EFLC',  'EFL Cup (Carabao Cup)',   0.65, true),
  ('CHAMP', 'EFL Championship',        0.60, false)   -- untuk profil awal klub promosi
on conflict (code) do nothing;

-- Aturan FPL yang sudah terverifikasi untuk 2026/27.
-- Aturan poin lainnya diisi worker dari bootstrap-static (game_config/scoring jika tersedia)
-- atau dimasukkan manual dari halaman aturan resmi FPL. Jangan menebak nilainya.
insert into public.fpl_scoring_rules (season_id, rule_key, value, notes)
select s.id, r.rule_key, r.value, r.notes
from public.seasons s
cross join (values
  ('defcon_threshold_DEF', 10, 'CBIT: clearances, blocks, interceptions, tackles'),
  ('defcon_threshold_MID', 12, 'CBIRT: + ball recoveries'),
  ('defcon_threshold_FWD', 12, 'CBIRT: + ball recoveries'),
  ('defcon_points',         2, 'maksimal 2 poin per laga'),
  ('bps_cbi_per_point',     3, '1 BPS per 3 clearances/blocks/interceptions (2026/27)')
) as r(rule_key, value, notes)
where s.label = '2026/27'
on conflict (season_id, rule_key) do nothing;

-- Konfigurasi analisis default (bisa diubah tanpa deploy)
insert into public.app_config (key, value) values
  ('recency_tau_days',            '120'),
  ('promoted_tau_days',           '60'),
  ('manager_change_weight',       '0.5'),
  ('min_minutes_teammate_effect', '450'),
  ('monte_carlo_runs',            '10000'),
  ('deadline_checkpoints_min',    '[2880, 1440, 360, 120, 60, 15]'),
  ('material_change_xpts',        '0.5'),
  ('ai_tier',                     '"free"'),
  ('ai_daily_budget_usd',         '3'),
  ('retention_days',              '{"raw_payloads": 14, "odds_snapshots": 90, "ai_cache": 30, "job_runs": 60}')
on conflict (key) do nothing;
```

### 6.2 `supabase/tests/001_rls_test.sql` (pgTAP, dijalankan `supabase test db`)

```sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

-- Data uji (sebagai postgres)
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'user@test.local',  '{"name":"User"}');
insert into public.players (full_name, web_name) values ('Test Player', 'TestP');
insert into public.job_runs (job_name, status) values ('test_job', 'ok');
insert into public.user_watchlist (user_id, player_id)
select '00000000-0000-0000-0000-0000000000a1', id from public.players where web_name = 'TestP';

select ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'),
  'RLS aktif di semua tabel public');

select is((select is_admin from public.users where id = '00000000-0000-0000-0000-0000000000a1'), true,
  'pengguna pertama otomatis admin');
select is((select is_admin from public.users where id = '00000000-0000-0000-0000-0000000000b2'), false,
  'pengguna kedua bukan admin');

-- Anonim: tidak bisa membaca apa pun
set local role anon;
select is((select count(*) from public.players)::int, 0, 'anon tidak bisa membaca players');
reset role;

-- Pengguna biasa
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*) from public.players where web_name = 'TestP')::int, 1,
  'pengguna login bisa membaca players');
select is((select count(*) from public.job_runs)::int, 0, 'non-admin tidak bisa membaca job_runs');
select is((select count(*) from public.user_watchlist)::int, 0, 'tidak bisa melihat watchlist orang lain');
reset role;

-- Admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from public.job_runs where job_name = 'test_job')::int, 1, 'admin bisa membaca job_runs');
reset role;

select * from finish();
rollback;
```

Hasil yang diharapkan: `1..8` dan delapan baris `ok`.

---

## 7. Worker (Python) — Kerangka Infrastruktur

Bagian ini hanya fondasi agar worker bisa jalan, terhubung ke DB, menjadi leader scheduler, dan menyelesaikan satu pipeline nyata (FPL → DB). Logika analisis dikerjakan di fase berikutnya sesuai BLUEPRINT.md.

### 7.1 Struktur

```text
services/worker/
├── Dockerfile
├── pyproject.toml
├── uv.lock
├── app/
│   ├── main.py               # FastAPI app + lifespan (start/stop scheduler & leader loop)
│   ├── config.py             # pydantic-settings, baca .env
│   ├── db.py                 # SQLAlchemy engine (psycopg3) + session
│   ├── logging.py            # structlog JSON
│   ├── api/
│   │   ├── health.py         # GET /v1/health
│   │   └── deps.py           # verifikasi JWT Supabase via JWKS
│   ├── scheduler/
│   │   ├── leader.py         # advisory lock leader election
│   │   ├── registry.py       # daftar job statis + checkpoint deadline dinamis
│   │   └── runner.py         # wrapper: catat job_runs, tangkap error
│   ├── sources/
│   │   ├── base.py           # httpx client, rate limit, retry (tenacity), simpan raw_payloads, api_usage
│   │   └── fpl.py            # adapter FPL (bootstrap-static, fixtures, event-status, ...)
│   └── jobs/
│       ├── sync_bootstrap.py
│       └── sync_fixtures.py  # termasuk deteksi perubahan jadwal → fixture_changes
└── tests/
    ├── fixtures/fpl/         # sampel JSON nyata (bootstrap-static dipangkas, fixtures)
    ├── test_fpl_parser.py
    ├── test_fixture_changes.py
    └── test_leader.py
```

### 7.2 `services/worker/pyproject.toml`

```toml
[project]
name = "taktikfpl-worker"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "apscheduler>=3.10,<4",
  "sqlalchemy>=2.0.30",
  "psycopg[binary]>=3.2",
  "pydantic>=2.8",
  "pydantic-settings>=2.4",
  "httpx>=0.27",
  "tenacity>=8.5",
  "structlog>=24.1",
  "pyjwt[crypto]>=2.9",
  "redis>=5.0",
  "pandas>=2.2",
  "numpy>=2.0",
  "scipy>=1.13",
  "scikit-learn>=1.5",
  "lightgbm>=4.5",
  "pulp>=2.9",
  "google-genai>=1.0",
  "feedparser>=6.0",
  "rapidfuzz>=3.9",
  "pywebpush>=2.0",
  "sentry-sdk>=2.10",
]

[dependency-groups]
dev = [
  "pytest>=8.3",
  "pytest-asyncio>=0.24",
  "respx>=0.21",
  "ruff>=0.6",
  "mypy>=1.11",
]

[tool.ruff]
line-length = 110
target-version = "py312"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

> Python dikunci di 3.12 karena beberapa paket ilmiah (LightGBM, PuLP) paling stabil di versi ini.

### 7.3 Leader election (inti `app/scheduler/leader.py`)

```python
import asyncio
import structlog
from sqlalchemy import text
from sqlalchemy.engine import Engine

log = structlog.get_logger()
LOCK_SQL = text("select pg_try_advisory_lock(hashtext('taktikfpl:scheduler'))")


class SchedulerLeader:
    """Hanya satu proses worker yang menjalankan APScheduler.

    Lock dipegang oleh SATU koneksi yang dibiarkan terbuka selama proses hidup.
    Koneksi harus lewat Session pooler (5432) atau direct, BUKAN transaction pooler (6543).
    """

    def __init__(self, engine: Engine, start_scheduler, stop_scheduler, retry_seconds: int = 30):
        self._engine = engine
        self._start = start_scheduler
        self._stop = stop_scheduler
        self._retry = retry_seconds
        self._conn = None
        self.is_leader = False

    def _try_acquire(self):
        conn = self._engine.connect()
        got = conn.execute(LOCK_SQL).scalar()
        conn.commit()  # tutup transaksi; advisory lock level sesi tetap dipegang
        if got:
            return conn
        conn.close()
        return None

    def _heartbeat(self) -> None:
        self._conn.execute(text("select 1"))
        self._conn.commit()

    async def run(self) -> None:
        """Loop seumur proses: rebut lock, lalu jaga koneksi tetap hidup."""
        while True:
            try:
                if not self.is_leader:
                    conn = await asyncio.to_thread(self._try_acquire)
                    if conn is not None:
                        self._conn, self.is_leader = conn, True
                        log.info("scheduler.leader_acquired")
                        self._start()
                    else:
                        log.info("scheduler.standby")
                else:
                    await asyncio.to_thread(self._heartbeat)
            except Exception as exc:  # koneksi putus / DB sementara tidak tersedia
                log.warning("scheduler.leader_error", error=str(exc))
                self.release()  # hentikan scheduler; pemilihan ulang di putaran berikut
            await asyncio.sleep(self._retry)

    def release(self) -> None:
        if self.is_leader:
            self._stop()
        if self._conn is not None:
            try:
                self._conn.close()  # menutup koneksi otomatis melepas advisory lock
            except Exception:
                pass
        self._conn = None
        self.is_leader = False
```

### 7.4 Kontrak modul lain (ditulis Claude Code)

| Modul | Kontrak |
|---|---|
| `config.py` | `Settings(BaseSettings)` membaca semua variabel di Bagian 9; validasi wajib: `DATABASE_URL`, `SUPABASE_URL`. Variabel opsional boleh kosong; fitur terkait dinonaktifkan dan dilaporkan di `/v1/health`. |
| `db.py` | `create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5, max_overflow=5)`; ubah skema `postgresql://` menjadi `postgresql+psycopg://` otomatis. |
| `sources/base.py` | `SourceClient(name, base_url, rps, daily_quota)`; tiap request: rate-limit, retry 429/5xx (exponential backoff + jitter, maks 5), simpan ke `raw_payloads` (body jsonb + hash), increment `api_usage`; tolak request jika kuota harian habis. |
| `sources/fpl.py` | method: `bootstrap_static()`, `fixtures(event=None)`, `element_summary(id)`, `event_live(gw)`, `event_status()`, `set_piece_notes()`, `entry(id)`, `entry_history(id)`, `entry_transfers(id)`, `entry_picks(id, gw)`, `league_classic(id, page)`. Header `User-Agent: TaktikFPL/0.1 (personal use)`. |
| `scheduler/runner.py` | dekorator `@job("nama")` → insert `job_runs` (running) → eksekusi → update `ok/failed` + `stats`/`error`. |
| `scheduler/registry.py` | APScheduler `AsyncIOScheduler` dengan `SQLAlchemyJobStore(url=DATABASE_URL, tablename='apscheduler_jobs', tableschema='scheduler')`, timezone UTC. Job awal: `sync_bootstrap` (30 menit), `sync_fixtures` (15 menit), `poll_event_status` (10 menit), `cleanup_retention` (harian 03:00 UTC). Fungsi `reschedule_deadline_checkpoints(gw)` membuat job `date` untuk tiap menit di `deadline_checkpoints_min`. |
| `api/health.py` | `GET /v1/health` → `{status, version, is_leader, db_ok, redis_ok, last_jobs: [{job_name, status, finished_at}], sources: {fpl: last_fetch, ...}, ai_tier, missing_optional_env: [...]}`. Selalu 200 jika proses hidup dan DB terjangkau; 503 jika DB tidak terjangkau. |
| `api/deps.py` | Verifikasi `Authorization: Bearer <JWT Supabase>` dengan JWKS `SUPABASE_JWKS_URL` (cache 10 menit). Endpoint admin memeriksa `users.is_admin`. |

### 7.5 Pemetaan pipeline pertama (FPL → DB)

| Sumber (FPL) | Tabel | Aturan |
|---|---|---|
| `bootstrap-static.events[]` | `gameweeks` | `number = id`, `fpl_event_id = id`, `deadline_utc = deadline_time`, flag `is_current/is_next/is_finished`; jika `deadline_time` berubah → panggil `reschedule_deadline_checkpoints` |
| `bootstrap-static.teams[]` | `teams`, `team_external_ids(source='fpl')`, `team_seasons` | cocokkan via `fpl_team_code = code`; `fpl_team_id = id` |
| `bootstrap-static.elements[]` | `players`, `player_external_ids(source='fpl_code')`, `player_seasons` | cocokkan via `fpl_code = code`; `fpl_element_id = id`; posisi dari `element_type` (1 GKP, 2 DEF, 3 MID, 4 FWD — baca `element_types` jangan hardcode) |
| `elements[].status, chance_of_playing_*, news, news_added` | `player_status_snapshots` | **insert hanya jika berbeda** dari snapshot terakhir |
| `elements[].now_cost, selected_by_percent, transfers_*_event` | `price_snapshots` | upsert per hari (`captured_on` = tanggal UTC) |
| `fixtures/` | `fixtures` (competition `PL`) | upsert via `(season_id, fpl_fixture_id)`; bandingkan `kickoff_time`, `event`, status → tulis `fixture_changes`; hitung ulang `gameweeks.is_blank/is_double` dari `v_gw_team_fixture_counts` |
| `event-status/` | `gameweeks.bonus_confirmed`, `leagues_updated` | saat keduanya true untuk GW terakhir → set `scores_final_at`, picu `gw_finalize` (Fase 2) |

---

## 8. Web (Next.js) — Kerangka Infrastruktur

### 8.1 Paket & struktur

```text
apps/web/
├── package.json
├── next.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx            # theme provider (data-theme), font, PWA meta
│   │   ├── page.tsx              # Beranda (sementara: daftar pemain dari v_player_current)
│   │   ├── login/page.tsx        # magic link
│   │   ├── auth/callback/route.ts
│   │   └── admin/health/page.tsx # job_runs + /v1/health worker (admin saja)
│   ├── lib/
│   │   ├── supabase/server.ts    # createServerClient (@supabase/ssr)
│   │   ├── supabase/client.ts    # createBrowserClient
│   │   ├── database.types.ts     # hasil `supabase gen types`
│   │   ├── worker.ts             # fetch ke WORKER_API_URL dengan JWT user
│   │   └── time.ts               # format WIB
│   ├── components/PlayerHeadshot.tsx
│   ├── styles/tokens.css         # dari BLUEPRINT 11.2
│   └── middleware.ts             # refresh sesi Supabase, proteksi rute
└── public/manifest.webmanifest
```

Dependensi utama: `next`, `react`, `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `tailwindcss`, `zod`, `date-fns-tz`.

### 8.2 Aturan

- Semua halaman selain `/login` dan `/auth/callback` wajib login (middleware).
- Browser memakai `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; **tidak pernah** memakai secret key.
- Panggilan ke worker hanya dari server (Route Handler/Server Action) dengan meneruskan JWT pengguna.
- Foto pemain: `PLAYER_PHOTO_URL_TEMPLATE` di-resolve di server; komponen `PlayerHeadshot` menampilkan fallback inisial jika gagal.

---

## 9. Environment & Secret Matrix

### 9.1 Di mana tiap variabel disimpan

| Variabel | `.env` lokal | Vercel | Railway | GitHub Actions | Rahasia? |
|---|:-:|:-:|:-:|:-:|:-:|
| `SUPABASE_PROJECT_REF` | ✓ | | | ✓ (secret) | Tidak (tapi simpan sebagai secret di CI) |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ | ✓ | | Tidak |
| `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✓ | ✓ | | | Tidak |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | ✓ | | ✓ | | **Ya** |
| `SUPABASE_JWKS_URL` | ✓ | | ✓ | | Tidak |
| `DATABASE_URL` (lokal: `supabase start`; produksi: Session pooler + password) | ✓ | | ✓ | | **Ya** |
| `SUPABASE_DB_PASSWORD` | | | | ✓ | **Ya** |
| `SUPABASE_ACCESS_TOKEN` (Personal Access Token Supabase) | | | | ✓ | **Ya** |
| `REDIS_URL` | ✓ | | ✓ | | **Ya** (produksi) |
| `WORKER_API_URL` | ✓ | ✓ | | | Tidak |
| `FPL_TEAM_ID`, `FPL_MINI_LEAGUE_IDS`, `FPL_H2H_LEAGUE_IDS` | ✓ | | ✓ | | Tidak |
| `FPL_SESSION_COOKIE` (opsional) | ✓ | | ✓ | | **Ya** |
| `PLAYER_PHOTO_URL_TEMPLATE`, `PLAYER_PHOTO_FALLBACK_TEMPLATE`, `TEAM_BADGE_URL_TEMPLATE` | ✓ | ✓ | ✓ | | Tidak |
| `GEMINI_API_KEY` | ✓ | | ✓ | | **Ya** |
| `AI_TIER`, `GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_PREMIUM_MODEL`, `AI_DAILY_BUDGET_USD` | ✓ | | ✓ | | Tidak |
| `API_FOOTBALL_KEY`, `ODDS_API_KEY`, `GNEWS_API_KEY`, `SPORTMONKS_API_TOKEN` | ✓ | | ✓ | | **Ya** |
| `VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ✓ | ✓ | ✓ | | Tidak |
| `VAPID_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN` | ✓ | | ✓ | | **Ya** |
| `TELEGRAM_CHAT_ID`, `VAPID_SUBJECT` | ✓ | | ✓ | | Tidak |
| `SENTRY_DSN` (opsional) | ✓ | ✓ | ✓ | | Tidak |

### 9.2 Nilai lokal default (setelah `supabase start`)

```env
SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
REDIS_URL=redis://127.0.0.1:6379/0
WORKER_API_URL=http://127.0.0.1:8000
# publishable & secret key lokal: salin dari output `supabase status`
```

### 9.3 Aturan repo publik

1. `.env` sudah di-ignore; `.env.example` hanya berisi nama variabel dan nilai non-rahasia.
2. CI menjalankan **gitleaks** di setiap push/PR. Commit yang mengandung secret gagal.
3. Jika secret pernah ter-commit: **rotasi** key di penyedia (jangan hanya menghapus commit), lalu bersihkan riwayat.
4. Disarankan: ubah repo menjadi **Private** selama pengembangan.

---

## 10. Docker, CI/CD & Deploy

### 10.1 Root: `package.json` & `pnpm-workspace.yaml`

```json
{
  "name": "taktikfpl",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:test": "supabase test db",
    "db:types": "supabase gen types typescript --local > apps/web/src/lib/database.types.ts",
    "dev:web": "pnpm --filter web dev",
    "dev:worker": "cd services/worker && uv run uvicorn app.main:app --reload --port 8000",
    "redis:up": "docker compose up -d redis"
  },
  "devDependencies": {
    "supabase": "^2.0.0"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
```

> Versi `packageManager` dan `supabase` boleh dinaikkan ke versi stabil terbaru saat implementasi.

### 10.2 `docker-compose.yml`

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5

  # Opsional: jalankan worker di container (default: jalankan dengan `pnpm dev:worker`)
  worker:
    profiles: ["worker"]
    build:
      context: .
      dockerfile: services/worker/Dockerfile
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:postgres@host.docker.internal:54322/postgres
      REDIS_URL: redis://redis:6379/0
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - "8000:8000"
    depends_on:
      redis:
        condition: service_healthy
```

### 10.3 `services/worker/Dockerfile`

```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# libgomp1 dibutuhkan LightGBM
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY services/worker/pyproject.toml services/worker/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY services/worker/app ./app
ENV PATH="/app/.venv/bin:$PATH"

RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
```

### 10.4 `railway.toml`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "services/worker/Dockerfile"
watchPatterns = ["services/worker/**", "railway.toml"]

[deploy]
healthcheckPath = "/v1/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

Pengaturan Railway (dashboard): 1 service dari repo GitHub, root = repo, **1 replica**, region terdekat yang tersedia (Asia Tenggara bila ada), isi variabel sesuai Bagian 9.

### 10.5 Vercel

- Import repo → **Root Directory: `apps/web`**, framework Next.js, install command `pnpm install`.
- Isi variabel `NEXT_PUBLIC_*`, `WORKER_API_URL`, template foto/badge.
- Setelah domain Vercel didapat, tambahkan ke Supabase: **Authentication → URL Configuration** → Site URL dan Redirect URL `https://<domain>/auth/callback`.

### 10.6 `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start local database (applies migrations)
        run: supabase db start
      - name: RLS & schema tests
        run: supabase test db

  worker:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/worker
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run mypy app
      - run: uv run pytest -q

  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter web lint
      - run: pnpm --filter web typecheck
      - run: pnpm --filter web build
        env:
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ci-placeholder
          WORKER_API_URL: http://127.0.0.1:8000
```

### 10.7 `.github/workflows/db-migrate.yml`

```yaml
name: db-migrate

on:
  push:
    branches: [main]
    paths:
      - "supabase/migrations/**"
  workflow_dispatch:

concurrency:
  group: db-migrate
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  migrate:
    runs-on: ubuntu-latest
    # Buat environment "production" di GitHub → Settings → Environments,
    # aktifkan "Required reviewers" (Dilan) agar setiap migrasi produksi butuh persetujuan.
    environment: production
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase link --project-ref "$SUPABASE_PROJECT_REF"
      - name: Preview
        run: supabase db push --dry-run
      - name: Apply
        run: supabase db push
```

> Seed produksi dijalankan **sekali** secara manual: `supabase db push --include-seed` (Langkah 7), bukan di workflow.

### 10.8 `.gitleaks.toml`

```toml
[extend]
useDefault = true

[[rules]]
id = "supabase-secret-key"
description = "Supabase secret key"
regex = '''sb_secret_[A-Za-z0-9_\-]{20,}'''
tags = ["supabase", "secret"]
```

---

## 11. Operasional: Retensi, Backup, Monitoring, Biaya

### 11.1 Retensi data (job `cleanup_retention`, harian)

| Tabel | Simpan | Catatan |
|---|---|---|
| `raw_payloads` | 14 hari | Payload besar; cukup untuk debug & replay |
| `odds_snapshots` | 90 hari | Ringkasan per fixture tetap ada di `fixture_context` |
| `ai_cache` | 30 hari / `expires_at` | |
| `job_runs` | 60 hari | |
| `player_status_snapshots`, `price_snapshots`, `fixture_changes` | permanen | Kecil, berguna untuk analisis |

Nilai diambil dari `app_config.retention_days`. Free plan Supabase membatasi ukuran DB (cek limit terbaru di dashboard); halaman `/admin/health` menampilkan ukuran tabel terbesar (`pg_total_relation_size`).

### 11.2 Backup

- Supabase menyimpan backup harian sesuai paket.
- Tambahan: job mingguan mengekspor `projections`, `recommendations`, `model_evaluations` GW terakhir ke bucket `exports/<admin-user-id>/` sebagai JSON.

### 11.3 Monitoring

- `/v1/health` dipakai healthcheck Railway.
- Halaman `/admin/health`: status job terakhir, umur data tiap sumber, kuota `api_usage`, biaya AI harian (`ai_runs`), status leader.
- Alert ke Telegram/push jika: job gagal 3× berturut-turut, data FPL lebih tua dari 2 jam saat H-1 deadline, atau kuota API > 90%.
- Sentry opsional untuk error web & worker.

### 11.4 Perkiraan biaya awal

| Layanan | Paket awal | Catatan |
|---|---|---|
| Supabase | Free | Project free bisa dijeda jika tidak aktif lama; worker yang terus berjalan membuatnya tetap aktif |
| Vercel | Hobby (gratis) | Untuk pemakaian pribadi |
| Railway | Paket berbayar terkecil | Worker harus always-on; cek harga terbaru |
| Upstash Redis | Free | Cukup untuk cache & lock |
| Gemini API | Free tier (Flash) | Argon hanya bila billing aktif (BLUEPRINT 10.0) |
| API-Football | Free (kuota harian kecil) → Pro saat fitur live | `api_usage` menjaga kuota |
| GitHub Actions | Gratis untuk repo publik; kuota menit untuk repo private | |

---

## 12. Langkah Eksekusi untuk Claude Code

Kerjakan berurutan. Setiap langkah punya **verifikasi**; jangan lanjut jika gagal.

### Langkah 1 — Prasyarat

Periksa versi: `git --version`, `node -v` (≥ 22), `pnpm -v`, `python3 --version` (3.12), `uv --version`, `docker info`.
Pasang yang kurang (pnpm via `corepack enable`, uv via installer resmi Astral). Docker harus berjalan.
**Verifikasi:** semua perintah di atas berhasil.

### Langkah 2 — Kerangka monorepo

Buat file root dari Bagian 10.1, 10.2, 10.4, 10.8 dan folder sesuai Bagian 3. Tambahkan `CHANGELOG.md`.
Pastikan `.gitignore` sudah mengecualikan `.env`.
**Verifikasi:** `pnpm install` sukses; `git status` tidak menampilkan `.env`.

### Langkah 3 — Supabase CLI

```bash
pnpm exec supabase init          # membuat supabase/config.toml (jangan timpa jika sudah ada)
pnpm exec supabase login         # Dilan login di browser
pnpm exec supabase link --project-ref <SUPABASE_PROJECT_REF dari .env>
```

Sesuaikan `supabase/config.toml`:
- `[db] major_version` = versi Postgres project produksi (lihat Dashboard → Settings → Infrastructure; `supabase link` juga memberi peringatan bila beda).
- `[auth] site_url = "http://127.0.0.1:3000"`, `additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback"]`.
- `[auth.email] enable_confirmations = false` (lokal saja).

**Verifikasi:** `supabase/config.toml` ada; `supabase projects list` menampilkan project yang ter-link.

### Langkah 4 — Migrasi & seed

Buat 14 file di `supabase/migrations/` dan `supabase/seed.sql` serta `supabase/tests/001_rls_test.sql` **persis** dari Bagian 5 dan 6.
**Verifikasi:**
```bash
pnpm db:start
pnpm db:reset          # menjalankan semua migrasi + seed dari nol
pnpm db:test           # harus: 8/8 ok
```
Lalu cek di Studio lokal (http://127.0.0.1:54323): 56 tabel, 4 view, bucket `player-photos` & `exports`.

### Langkah 5 — Generate types

```bash
pnpm db:types
```
**Verifikasi:** `apps/web/src/lib/database.types.ts` berisi tipe `players`, `fixtures`, `v_player_current`.

### Langkah 6 — Konfirmasi ke Dilan sebelum produksi

Tampilkan `supabase db push --dry-run` dan minta persetujuan Dilan. **Jangan lanjut tanpa jawaban "ya".**

### Langkah 7 — Migrasi produksi (setelah disetujui)

```bash
pnpm exec supabase db push --include-seed
```
Di Dashboard Supabase:
- Authentication → Providers: aktifkan Email (magic link).
- Setelah Dilan login pertama kali (otomatis admin), matikan **Allow new users to sign up**.
- Database → Publications: pastikan tabel di Bagian 5.13 ada di `supabase_realtime`.

**Verifikasi:** `supabase migration list` menunjukkan 14 migrasi sama di Local dan Remote.

### Langkah 8 — Worker

Buat `services/worker` sesuai Bagian 7 (pyproject, struktur, leader, kontrak modul, Dockerfile), lalu `uv lock`.
**Verifikasi:**
```bash
pnpm redis:up
pnpm dev:worker
curl -s http://127.0.0.1:8000/v1/health   # status ok, is_leader true, db_ok true
cd services/worker && uv run ruff check . && uv run mypy app && uv run pytest -q
```
Uji leader: jalankan instance kedua di port 8001 → `is_leader` false; matikan instance pertama → instance kedua menjadi leader dalam ≤ 30 detik.

### Langkah 9 — Pipeline pertama (FPL → DB)

Implementasikan `sources/fpl.py`, `jobs/sync_bootstrap.py`, `jobs/sync_fixtures.py` sesuai Bagian 7.5. Jalankan sekali manual lewat endpoint admin atau skrip.
**Verifikasi (SQL di Studio lokal):**
```sql
select count(*) from public.teams;                               -- 20
select count(*) from public.gameweeks;                           -- 38
select count(*) from public.v_player_current;                    -- ± 600–800
select count(*) from public.fixtures where competition_id =
  (select id from public.competitions where code = 'PL');        -- 380
select job_name, status from public.job_runs order by id desc limit 5;
```
Uji deteksi perubahan jadwal: ubah `kickoff_utc` satu fixture secara manual → jalankan `sync_fixtures` → muncul baris `fixture_changes` bertipe `kickoff_moved` dan kickoff kembali ke nilai FPL.

### Langkah 10 — Web

Buat `apps/web` sesuai Bagian 8 (`pnpm create next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*"`), tambahkan skrip `typecheck` (`tsc --noEmit`), login magic link (email lokal terlihat di Mailpit http://127.0.0.1:54324), halaman daftar pemain dengan headshot, halaman `/admin/health`.
**Verifikasi:** login berhasil; daftar pemain tampil dengan foto/fallback; jam kick-off tampil dalam WIB; pengguna non-login diarahkan ke `/login`.

### Langkah 11 — CI/CD

Buat `.github/workflows/ci.yml` dan `db-migrate.yml` (Bagian 10.6–10.7). Minta Dilan menambahkan GitHub secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` dan environment `production` dengan required reviewer.
**Verifikasi:** PR uji → semua job CI hijau.

### Langkah 12 — Deploy

Dengan persetujuan Dilan: hubungkan Railway (Bagian 10.4) dan Vercel (Bagian 10.5), isi variabel dari Bagian 9, tambahkan URL Vercel ke Supabase Auth.
**Verifikasi:** `https://<worker>/v1/health` → ok & leader; web produksi bisa login dan menampilkan pemain dari DB produksi; `job_runs` produksi terisi tiap 15–30 menit.

---

## 13. Definition of Done

- [ ] `supabase db reset` lokal sukses dari nol; `supabase test db` 8/8 ok
- [ ] Migrasi produksi identik dengan lokal (`supabase migration list`)
- [ ] Semua tabel `public` ber-RLS; anon tidak bisa membaca apa pun; pengguna kedua tidak bisa daftar
- [ ] Worker: health ok, satu leader, `job_runs` mencatat setiap job, `raw_payloads` & `api_usage` terisi
- [ ] Data FPL musim berjalan masuk: 20 tim, 38 GW, ±700 pemain, 380 fixture PL
- [ ] Deteksi perubahan jadwal terbukti dengan uji manual
- [ ] Web produksi: login, daftar pemain + headshot, waktu dalam WIB
- [ ] CI hijau (gitleaks, DB test, worker, web); migrasi produksi butuh approval
- [ ] Tidak ada secret di repo (gitleaks bersih)
- [ ] `CHANGELOG.md` mencatat semua penyimpangan dari blueprint

---

### Riwayat versi

| Versi | Tanggal | Perubahan |
|---|---|---|
| v1.0 | 2026-10-20 | Rilis awal: 14 migrasi (56 tabel, 4 view, RLS, Realtime, Storage), seed, pgTAP, worker & web skeleton, CI/CD, deploy, langkah eksekusi |


