-- 1) Data sepakbola & hasil model: baca untuk pengguna login, tulis hanya worker.
-- 2) Data operasional: baca hanya admin.
-- 3) Data privat worker: tanpa akses dari browser sama sekali.
do $$
declare
  t text;
  reference_tables text[] := array[
    'seasons','competitions','teams','team_external_ids','team_seasons','managers','manager_tenures',
    'players','player_external_ids','player_seasons',
    'gameweeks','referees','fixtures','fixture_changes','fixture_conditions',
    'lineups','player_match_stats','team_match_stats','match_events','shots',
    'fpl_scoring_rules','player_fpl_gw_stats','player_status_snapshots','price_snapshots','set_piece_roles',
    'player_archetypes','player_form_features','team_style_profiles','manager_profiles',
    'teammate_effects','matchup_edges','fixture_context',
    'odds_snapshots','news_items','news_entities',
    'model_runs','projections','model_evaluations','evidence','analysis_reports'
  ];
  admin_tables text[] := array['job_runs','ai_runs','api_usage','unmatched_entities','app_config'];
  private_tables text[] := array['raw_payloads','ai_cache'];
begin
  foreach t in array reference_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select_authenticated', t);
  end loop;

  foreach t in array admin_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_admin()))',
      t || '_select_admin', t);
  end loop;

  foreach t in array private_tables loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- Data milik pengguna
alter table public.users               enable row level security;
alter table public.user_fpl_entries    enable row level security;
alter table public.user_squad_picks    enable row level security;
alter table public.user_transfer_plans enable row level security;
alter table public.user_watchlist      enable row level security;
alter table public.notifications       enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.recommendations     enable row level security;
alter table public.recommendation_reasons enable row level security;

create policy users_select_own on public.users
  for select to authenticated using (id = (select auth.uid()));
create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));   -- kolom is_admin dikunci lewat GRANT kolom di bawah

create policy user_fpl_entries_all_own on public.user_fpl_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_squad_picks_all_own on public.user_squad_picks
  for all to authenticated
  using (exists (select 1 from public.user_fpl_entries e
                 where e.id = entry_id and e.user_id = (select auth.uid())))
  with check (exists (select 1 from public.user_fpl_entries e
                      where e.id = entry_id and e.user_id = (select auth.uid())));

create policy user_transfer_plans_all_own on public.user_transfer_plans
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_watchlist_all_own on public.user_watchlist
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_all_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy recommendations_select_visible on public.recommendations
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy recommendation_reasons_select_visible on public.recommendation_reasons
  for select to authenticated
  using (exists (select 1 from public.recommendations r where r.id = recommendation_id));

-- Kolom pengguna: hanya preferensi yang boleh diubah dari browser
revoke update on public.users from authenticated;
grant update (display_name, timezone, locale, theme, risk_profile) on public.users to authenticated;

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
