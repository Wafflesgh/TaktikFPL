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
