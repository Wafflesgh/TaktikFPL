-- Arsip data jangka panjang untuk machine learning (docs/adr/0001-data-arsip-jangka-panjang.md).
-- Payload mentah sumber eksternal disimpan permanen sebagai file JSON gzip immutable di bucket
-- privat `archive`; tabel ini adalah manifest-nya (apa, kapan, di mana, checksum).

insert into storage.buckets (id, name, public)
values ('archive', 'archive', false)
on conflict (id) do nothing;
-- Tanpa policy storage: hanya worker (secret key) yang bisa membaca/menulis bucket ini.

create table public.data_archives (
  id               bigserial primary key,
  source           text not null,                 -- fpl | api_football | understat | odds_api | ...
  endpoint         text not null,                 -- mis. 'bootstrap-static/', 'event/{gw}/live/'
  season_label     text,                          -- '2026/27'
  gameweek         int,
  reason           text not null check (reason in
                   ('daily','deadline','gw_final','season_end','backfill','manual')),
  captured_at      timestamptz not null default now(),   -- waktu data diambil (point-in-time)
  storage_backend  text not null check (storage_backend in ('supabase','local')),
  path             text not null unique,
  bytes            int  not null,
  sha256           text not null,                 -- hash isi JSON (sebelum gzip)
  record_count     int,
  meta             jsonb not null default '{}'::jsonb
);
create index data_archives_lookup_idx on public.data_archives (source, endpoint, captured_at desc);
create index data_archives_hash_idx   on public.data_archives (source, endpoint, sha256);
create index data_archives_gw_idx     on public.data_archives (season_label, gameweek);

alter table public.data_archives enable row level security;
create policy data_archives_select_admin on public.data_archives
  for select to authenticated using ((select public.is_admin()));

-- Pemangkasan form harian (cleanup_retention) mencari snapshot per deadline GW berdasarkan as_of.
create index if not exists player_form_features_as_of_idx on public.player_form_features (as_of);

-- Pengaman: migrasi gagal jika ada tabel public tanpa RLS
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
