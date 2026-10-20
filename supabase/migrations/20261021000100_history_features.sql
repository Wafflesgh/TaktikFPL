-- Kolom tambahan untuk ML (aditif saja; docs/adr/0001-data-arsip-jangka-panjang.md):
-- fitur per laga yang tersedia di element-summary FPL dan dataset historis (2016/17–sekarang).

alter table public.player_fpl_gw_stats
  add column if not exists team_id            bigint references public.teams(id),
  add column if not exists opponent_team_id   bigint references public.teams(id),
  add column if not exists was_home           boolean,
  add column if not exists starts             int,
  add column if not exists fpl_xp             numeric(6,2),   -- 'xP': proyeksi poin resmi FPL untuk laga itu
  add column if not exists transfers_in       int,
  add column if not exists transfers_out      int,
  add column if not exists transfers_balance  int,
  add column if not exists source             text not null default 'fpl_api',  -- fpl_api | vaastav
  add column if not exists extra              jsonb not null default '{}'::jsonb;  -- statistik khusus musim

create index if not exists player_fpl_gw_stats_team_idx on public.player_fpl_gw_stats (team_id, gameweek_id);

-- Musim lampau: deadline GW tidak tersedia di dataset historis, diestimasi dari kick-off pertama.
alter table public.gameweeks
  add column if not exists deadline_estimated boolean not null default false;

alter table public.seasons
  add column if not exists data_source text not null default 'fpl_api';  -- fpl_api | vaastav

-- Pengaman RLS (tidak ada tabel baru, tetap dijaga)
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
