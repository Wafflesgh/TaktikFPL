-- Pemain musim berjalan + status & harga terbaru (dipakai daftar pemain di UI)
create view public.v_player_current
with (security_invoker = true) as
select
  p.id,
  p.web_name,
  p.full_name,
  p.fpl_code,
  p.photo_file,
  p.photo_url_resolved,
  ps.team_id,
  t.short_name        as team_short_name,
  ps.fpl_element_id,
  ps.fpl_position,
  ps.real_position,
  st.status,
  st.chance_next,
  st.news,
  st.captured_at      as status_captured_at,
  pr.price_tenths,
  pr.selected_by_pct
from public.players p
join public.player_seasons ps on ps.player_id = p.id and ps.left_on is null
join public.seasons s         on s.id = ps.season_id and s.is_current
join public.teams t           on t.id = ps.team_id
left join lateral (
  select x.status, x.chance_next, x.news, x.captured_at
  from public.player_status_snapshots x
  where x.player_id = p.id
  order by x.captured_at desc
  limit 1
) st on true
left join lateral (
  select y.price_tenths, y.selected_by_pct
  from public.price_snapshots y
  where y.player_id = p.id
  order by y.captured_on desc
  limit 1
) pr on true;

-- Fixture GW berikutnya + penanda perubahan jadwal 7 hari terakhir
create view public.v_next_gw_fixtures
with (security_invoker = true) as
select
  f.id,
  g.number                                  as gw,
  f.home_team_id,
  ht.short_name                             as home,
  f.away_team_id,
  awt.short_name                            as away,
  f.kickoff_utc,
  (f.kickoff_utc at time zone 'Asia/Jakarta') as kickoff_wib,
  f.status,
  f.difficulty_home,
  f.difficulty_away,
  exists (
    select 1 from public.fixture_changes c
    where c.fixture_id = f.id and c.detected_at > now() - interval '7 days'
  )                                         as recently_changed
from public.fixtures f
join public.gameweeks g on g.id = f.gameweek_id and g.is_next
join public.teams ht    on ht.id = f.home_team_id
join public.teams awt   on awt.id = f.away_team_id;

-- Proyeksi terbaru (run sukses terakhir) per pemain-fixture untuk GW berikutnya
create view public.v_latest_projections
with (security_invoker = true) as
select distinct on (p.player_id, p.fixture_id)
  p.*,
  r.run_type,
  r.finished_at as run_finished_at
from public.projections p
join public.model_runs r on r.id = p.model_run_id and r.status = 'ok'
join public.gameweeks g  on g.id = r.gameweek_id and g.is_next
order by p.player_id, p.fixture_id, r.finished_at desc;

-- Jumlah laga per tim per GW musim berjalan (deteksi Blank/Double GW)
create view public.v_gw_team_fixture_counts
with (security_invoker = true) as
select
  g.id      as gameweek_id,
  g.number  as gw,
  ts.team_id,
  count(f.id) as fixture_count
from public.gameweeks g
join public.seasons s       on s.id = g.season_id and s.is_current
join public.team_seasons ts on ts.season_id = g.season_id and ts.league_code = 'PL'
left join public.fixtures f on f.gameweek_id = g.id
  and (f.home_team_id = ts.team_id or f.away_team_id = ts.team_id)
  and f.status not in ('postponed','cancelled')
group by g.id, g.number, ts.team_id;
