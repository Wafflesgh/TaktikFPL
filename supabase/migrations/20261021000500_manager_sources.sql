-- Pelatih dari Wikidata (gratis, CC0): id entitas + foto (URL Wikimedia Commons, dimuat dari CDN —
-- bukan aset statis di repo). Riwayat masa jabatan disimpan sebagai fakta (tidak dihapus).
alter table public.managers
  add column if not exists wikidata_id text unique,
  add column if not exists photo_url   text;

create unique index if not exists manager_tenures_natural_uniq
  on public.manager_tenures (manager_id, team_id, start_date);
