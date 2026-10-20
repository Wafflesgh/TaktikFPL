-- player-photos: cache foto kepala pemain (baca publik, tulis hanya worker)
-- exports: file ekspor pribadi pengguna, folder pertama = user id
insert into storage.buckets (id, name, public)
values
  ('player-photos', 'player-photos', true),
  ('exports',       'exports',       false)
on conflict (id) do nothing;

create policy exports_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
