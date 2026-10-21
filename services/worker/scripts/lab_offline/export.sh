#!/bin/bash
# Ekspor data FPL produksi (read-only) ke CSV untuk backtest offline Model Lab.
# Jalankan dari root repo (Supabase CLI sudah login & ter-link):
#   bash services/worker/scripts/lab_offline/export.sh
set -euo pipefail
D="$(dirname "$0")/.data"
mkdir -p "$D"
Q="node_modules/.bin/supabase db query --linked -o csv"
$Q "select id,label,is_current from public.seasons" 2>/dev/null > "$D/seasons.csv"
$Q "select id,season_id,number,deadline_utc,is_finished from public.gameweeks" 2>/dev/null > "$D/gameweeks.csv"
$Q "select id,season_id,gameweek_id,home_team_id,away_team_id,kickoff_utc,status,home_goals,away_goals,
           difficulty_home,difficulty_away
    from public.fixtures" 2>/dev/null > "$D/fixtures.csv"
$Q "select player_id,season_id,fpl_position,team_id,joined_on from public.player_seasons" \
  2>/dev/null > "$D/player_seasons.csv"
$Q "select season_id,rule_key,value from public.fpl_scoring_rules" 2>/dev/null > "$D/scoring_rules.csv"
for sid in $($Q "select id from public.seasons" 2>/dev/null | tail -n +2); do
  $Q "select p.player_id,p.fixture_id,p.gameweek_id,p.minutes,p.total_points,p.goals_scored,p.assists,
             p.clean_sheets,p.goals_conceded,p.bonus,p.saves,p.yellow_cards,p.defensive_contribution,
             p.expected_goals,p.expected_assists,p.value_tenths,p.selected,p.team_id
      from public.player_fpl_gw_stats p join public.fixtures f on f.id = p.fixture_id
      where f.season_id = $sid" 2>/dev/null > "$D/stats_$sid.csv"
done
rm -rf "$D/cache"
wc -l "$D"/*.csv
