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
