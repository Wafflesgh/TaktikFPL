-- Rencana musim & chip (Fase 2): aturan chip dan game_settings dari bootstrap-static (tidak di-hardcode),
-- serta laporan 'season_plan' — satu snapshot permanen per GW sebagai patokan mingguan (ADR 0001:
-- data turunan kecil, disimpan untuk membandingkan rencana dari minggu ke minggu).

create table public.fpl_chips (
  season_id    int  not null references public.seasons(id) on delete cascade,
  chip_id      int  not null,            -- id chip di bootstrap-static
  name         text not null,            -- wildcard | freehit | bboost | 3xc | ...
  number       int  not null default 1,
  start_event  int  not null,
  stop_event   int  not null,
  chip_type    text,
  updated_at   timestamptz not null default now(),
  primary key (season_id, chip_id)
);

create table public.fpl_game_settings (
  season_id   int  not null references public.seasons(id) on delete cascade,
  key         text not null,             -- mis. squad_team_limit, max_extra_free_transfers
  value       jsonb,
  updated_at  timestamptz not null default now(),
  primary key (season_id, key)
);

alter table public.analysis_reports drop constraint if exists analysis_reports_report_type_check;
alter table public.analysis_reports add constraint analysis_reports_report_type_check check (report_type in
  ('weekly_draft','deadline_t60','player_deep_dive','team_tactics','gw_review','checkpoint','season_plan'));

-- Tabel referensi: terbaca publik (anon & authenticated), ditulis hanya oleh worker (role postgres).
do $$
declare
  t text;
begin
  foreach t in array array['fpl_chips','fpl_game_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_select_public', t);
  end loop;
end
$$;
