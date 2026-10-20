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
