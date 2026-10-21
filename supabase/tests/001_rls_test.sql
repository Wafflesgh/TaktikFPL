begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

-- Data uji (sebagai postgres)
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'user@test.local',  '{"name":"User"}');
insert into public.players (full_name, web_name) values ('Test Player', 'TestP');
insert into public.job_runs (job_name, status) values ('test_job', 'ok');
insert into public.user_watchlist (user_id, player_id)
select '00000000-0000-0000-0000-0000000000a1', id from public.players where web_name = 'TestP';

select ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'),
  'RLS aktif di semua tabel public');

select is((select is_admin from public.users where id = '00000000-0000-0000-0000-0000000000a1'), true,
  'pengguna pertama otomatis admin');
select is((select is_admin from public.users where id = '00000000-0000-0000-0000-0000000000b2'), false,
  'pengguna kedua bukan admin');

-- Anonim (aplikasi tanpa login): boleh membaca data FPL, tidak boleh membaca data pengguna
set local role anon;
select ok((select count(*) from public.players where web_name = 'TestP')::int = 1
          and (select count(*) from public.user_watchlist)::int = 0,
  'anon membaca players tetapi tidak watchlist');
reset role;

-- Pengguna biasa
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*) from public.players where web_name = 'TestP')::int, 1,
  'pengguna login bisa membaca players');
select is((select count(*) from public.job_runs)::int, 0, 'non-admin tidak bisa membaca job_runs');
select is((select count(*) from public.user_watchlist)::int, 0, 'tidak bisa melihat watchlist orang lain');
reset role;

-- Admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from public.job_runs where job_name = 'test_job')::int, 1, 'admin bisa membaca job_runs');
reset role;

select * from finish();
rollback;
