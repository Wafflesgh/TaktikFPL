#!/usr/bin/env bash
# Status check TaktikFPL: data, job worker, pemicu, web produksi, GitHub Actions, Supabase.
# Tanpa secret: DB lewat `supabase db query --linked` (login CLI lokal), sisanya endpoint publik.
# Pemakaian: bash scripts/status-check.sh   (dari root repo)
set -u
cd "$(dirname "$0")/.."

PROD="https://taktik-fpl.vercel.app"
REPO="Wafflesgh/TaktikFPL"
SB_URL=$(grep -h "^NEXT_PUBLIC_SUPABASE_URL=" apps/web/.env* 2>/dev/null | head -1 | cut -d= -f2-)
SB="npx --no-install supabase db query --linked -o csv"

# SQL dijadikan satu baris: CLI di Windows memotong argumen multi-baris.
q() { $SB "$(printf '%s' "$1" | tr '\n' ' ')" 2>&1 | grep -v "^Initialising"; }

echo "# Waktu cek: $(date -u -d '+7 hours' '+%Y-%m-%d %H:%M WIB')"

echo
echo "## 1. Job worker (8 hari; age_min = menit sejak sukses terakhir; max_age_min = batas sehat)"
q "with j as (
  select job_name,
    (array_agg(status order by started_at desc))[1] last_status,
    max(finished_at) filter (where status = 'ok') last_ok,
    count(*) filter (where status = 'failed' and started_at > now() - interval '24 hours') fails_24h,
    bool_or(status = 'running' and started_at < now() - interval '30 minutes') stuck,
    (array_agg(left(coalesce(error, ''), 140) order by started_at desc) filter (where status = 'failed'))[1] last_error
  from public.job_runs where started_at > now() - interval '8 days' group by 1)
select job_name, last_status,
  to_char(last_ok at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') last_ok_wib,
  round(extract(epoch from now() - last_ok) / 60)::int age_min,
  case when job_name in ('sync_fixtures', 'sync_news') then 45
       when job_name in ('sync_bootstrap', 'poll_event_status') then 75
       when job_name in ('cleanup_retention', 'sync_managers', 'sync_player_history', 'sync_understat', 'evaluate_model', 'run_projections') then 1560
  end max_age_min,
  fails_24h, stuck, last_error
from j order by job_name"

echo
echo "## 2. Pemicu pg_cron -> GitHub (6 terakhir; 204 = OK)"
q "select status_code, left(coalesce(error_msg, content::text, ''), 120) detail,
  to_char(created at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') wib
from net._http_response order by created desc limit 6"

echo
echo "## 3. Kesegaran data"
q "select 'next_gw' item, (select 'GW' || number || ' deadline ' || to_char(deadline_utc at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') || ' WIB' from public.gameweeks where is_next) value
union all select 'proyeksi_terakhir', (select to_char(max(finished_at) at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') || ' (' || round(extract(epoch from now() - max(finished_at)) / 3600, 1) || ' jam lalu)' from public.model_runs where status = 'ok')
union all select 'berita_terakhir_masuk', (select to_char(max(fetched_at) at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') || ' (' || count(*) filter (where fetched_at > now() - interval '24 hours') || ' item 24 jam)' from public.news_items)
union all select 'status_pemain_berubah', (select to_char(max(captured_at) at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') from public.player_status_snapshots)
union all select 'snapshot_harga', (select max(captured_on)::text from public.price_snapshots)
union all select 'fixture_diubah', (select to_char(max(updated_at) at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') from public.fixtures)
union all select 'arsip_terakhir', (select to_char(max(captured_at) at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') || ' (' || count(*) filter (where captured_at > now() - interval '24 hours') || ' arsip 24 jam)' from public.data_archives)
union all select 'jumlah_pemain', (select count(*)::text from public.players)
union all select 'ukuran_db', (select pg_size_pretty(pg_database_size(current_database())))"

echo
echo "## 4. Web produksi (kode HTTP, detik)"
TEAM=$(q "select t.id from public.teams t join public.team_seasons s on s.team_id = t.id join public.seasons se on se.id = s.season_id and se.is_current order by t.id limit 1" | tail -1)
PLAYER=$(q "select id from public.players order by id limit 1" | tail -1)
for path in "/" "/klub/$TEAM" "/pemain/$PLAYER" "/manifest.webmanifest"; do
  out=$(curl -s -o /tmp/tfpl_page.$$ -w "%{http_code} %{time_total}" --max-time 30 "$PROD$path")
  err=$(grep -c "Application error\|Internal Server Error" /tmp/tfpl_page.$$ 2>/dev/null)
  echo "$path -> $out (error_text=$err)"
done
rm -f /tmp/tfpl_page.$$

echo
echo "## 5. Supabase API & GitHub Actions"
if [ -n "$SB_URL" ]; then
  echo "supabase_rest -> $(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 15 "$SB_URL/rest/v1/") (401 = hidup, butuh key)"
fi
echo "github_actions (10 run terakhir, waktu WIB):"
curl -s --max-time 20 "https://api.github.com/repos/$REPO/actions/runs?per_page=10" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      for (const r of JSON.parse(s).workflow_runs ?? []) {
        const wib = new Date(Date.parse(r.created_at) + 7 * 36e5).toISOString().slice(5, 16).replace("T", " ");
        console.log(`  ${wib} ${r.name} [${r.event}] ${r.status}/${r.conclusion ?? "-"}`);
      }
    } catch { console.log("  (GitHub API tidak bisa dibaca)"); }
  });'
echo "githubstatus -> $(curl -s --max-time 15 https://www.githubstatus.com/api/v2/status.json | grep -o '"description":"[^"]*"' | head -1)"
echo "supabase_status -> $(curl -s --max-time 15 https://status.supabase.com/api/v2/status.json | grep -o '"description":"[^"]*"' | head -1)"
echo "vercel_status -> $(curl -s --max-time 15 https://www.vercel-status.com/api/v2/status.json | grep -o '"description":"[^"]*"' | head -1)"
