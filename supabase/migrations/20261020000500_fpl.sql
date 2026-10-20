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
