-- Aplikasi tanpa login (keputusan Dilan 2026-10-21): pengunjung (role anon) boleh MEMBACA data
-- FPL/analisis dan status worker. Data milik pengguna (users, watchlist, notifications, push,
-- rencana transfer, squad) dan tabel privat/biaya (raw_payloads, ai_cache, ai_runs) tetap tertutup.
-- Situs tidak diindeks mesin pencari (robots + X-Robots-Tag).

do $$
declare
  t text;
  public_tables text[] := array[
    'seasons','competitions','teams','team_external_ids','team_seasons','managers','manager_tenures',
    'players','player_external_ids','player_seasons',
    'gameweeks','referees','fixtures','fixture_changes','fixture_conditions',
    'lineups','player_match_stats','team_match_stats','match_events','shots',
    'fpl_scoring_rules','player_fpl_gw_stats','player_status_snapshots','price_snapshots','set_piece_roles',
    'player_archetypes','player_form_features','team_style_profiles','manager_profiles',
    'teammate_effects','matchup_edges','fixture_context',
    'odds_snapshots','news_items','news_entities',
    'model_runs','projections','model_evaluations','evidence','analysis_reports',
    -- status worker untuk /admin/health
    'job_runs','api_usage'
  ];
begin
  foreach t in array public_tables loop
    execute format('grant select on public.%I to anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_anon', t);
    execute format('create policy %I on public.%I for select to anon using (true)', t || '_select_anon', t);
  end loop;
end
$$;

-- View (security_invoker) mengikuti hak tabel dasarnya.
grant select on public.v_player_current, public.v_next_gw_fixtures, public.v_latest_projections,
  public.v_gw_team_fixture_counts, public.v_player_form to anon;

-- Rekomendasi umum (user_id null) juga terbaca tanpa login.
grant select on public.recommendations, public.recommendation_reasons to anon;
create policy recommendations_select_anon on public.recommendations
  for select to anon using (user_id is null);
create policy recommendation_reasons_select_anon on public.recommendation_reasons
  for select to anon using (exists (
    select 1 from public.recommendations r where r.id = recommendation_id and r.user_id is null));
