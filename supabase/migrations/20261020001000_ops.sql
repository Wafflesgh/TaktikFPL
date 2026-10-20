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
