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
