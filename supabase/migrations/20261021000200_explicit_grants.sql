-- Grant eksplisit untuk Data API (PostgREST). Project Supabase baru bisa dibuat dengan
-- "Automatically expose new tables" nonaktif; tanpa grant ini web tidak bisa membaca apa pun.
-- Aman bila default Supabase aktif (grant ganda tidak berefek). Akses baris tetap dijaga RLS
-- (20261020001200_rls.sql): anon tidak punya policy apa pun, tabel privat tidak punya policy.

grant usage on schema public to anon, authenticated, service_role;

-- Baca: semua tabel & view untuk pengguna login (difilter policy RLS masing-masing tabel).
grant select on all tables in schema public to authenticated;

-- Tulis: hanya tabel milik pengguna yang punya policy tulis.
grant insert, update, delete on
  public.user_fpl_entries,
  public.user_squad_picks,
  public.user_transfer_plans,
  public.user_watchlist,
  public.push_subscriptions
to authenticated;
grant update on public.notifications to authenticated;  -- menandai read_at
grant usage, select on all sequences in schema public to authenticated;

-- public.users: hanya kolom preferensi yang boleh diubah (ulang dari migrasi RLS, idempoten).
revoke update on public.users from authenticated;
grant update (display_name, timezone, locale, theme, risk_profile) on public.users to authenticated;

grant execute on function public.is_admin() to authenticated;

-- Worker memakai role postgres (pemilik tabel) sehingga tidak bergantung pada grant di atas.
