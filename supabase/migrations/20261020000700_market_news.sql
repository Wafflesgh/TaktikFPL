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
