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
