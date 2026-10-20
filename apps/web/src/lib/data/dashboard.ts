import "server-only";
import { playerPhotoUrls, teamBadgeUrl } from "@/lib/assets";
import { createClient } from "@/lib/supabase/server";

export type TeamInfo = { id: number; name: string; short: string; badge: string | null };

export type StandingRow = {
  team: TeamInfo;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
};

export type FormInfo = {
  label: string | null;
  score: number | null;
  reasons: string[];
  last4Ppm: number | null;
  seasonPpm: number | null;
  last4Xgi90: number | null;
  minutesShare: number | null;
  goalsMinusXg: number | null;
};

export type PlayerRow = {
  id: number;
  webName: string;
  fullName: string;
  team: TeamInfo | null;
  position: string | null;
  status: string | null;
  news: string | null;
  priceTenths: number | null;
  ownedPct: number | null;
  photos: string[];
  photosLarge: string[];
  form: FormInfo | null;
};

export type FixtureRow = {
  id: number;
  gw: number | null;
  home: TeamInfo | null;
  away: TeamInfo | null;
  kickoffUtc: string | null;
  status: string | null;
  fdrHome: number | null;
  fdrAway: number | null;
  recentlyChanged: boolean;
  homeGoals?: number | null;
  awayGoals?: number | null;
};

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** Semua data Beranda dalam satu panggilan server (RLS: pengguna login). */
export async function getDashboardData() {
  const supabase = await createClient();
  const { data: season } = await supabase.from("seasons").select("id, label").eq("is_current", true).maybeSingle();

  const [gwRes, teamRes, nextFxRes, resultsRes, liveRes, playerRes, formRes] = await Promise.all([
    supabase.from("gameweeks").select("number, deadline_utc, is_current, is_next, is_blank, is_double").or("is_current.eq.true,is_next.eq.true"),
    supabase.from("teams").select("id, name, short_name, fpl_team_code"),
    supabase.from("v_next_gw_fixtures").select("id, gw, home_team_id, away_team_id, kickoff_utc, status, difficulty_home, difficulty_away, recently_changed").order("kickoff_utc"),
    season
      ? supabase.from("fixtures").select("home_team_id, away_team_id, home_goals, away_goals").eq("season_id", season.id).eq("status", "finished")
      : Promise.resolve({ data: [] as { home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null }[] }),
    season
      ? supabase.from("fixtures").select("id, home_team_id, away_team_id, home_goals, away_goals, minute, status, kickoff_utc").eq("season_id", season.id).in("status", ["live", "ht"])
      : Promise.resolve({ data: [] }),
    supabase.from("v_player_current").select("id, web_name, full_name, fpl_code, photo_url_resolved, team_id, fpl_position, status, news, price_tenths, selected_by_pct").limit(1000),
    supabase.from("v_player_form").select("player_id, form_label, form_score, form_reasons, last4_points_per_match, season_points_per_match, last4_xgi90, last4_minutes_share, last4_goals_minus_xg"),
  ]);

  const teams = new Map<number, TeamInfo>(
    (teamRes.data ?? []).map((t) => [
      t.id,
      { id: t.id, name: t.name, short: t.short_name ?? t.name.slice(0, 3).toUpperCase(), badge: teamBadgeUrl(t.fpl_team_code) },
    ]),
  );

  const forms = new Map<number, FormInfo>(
    (formRes.data ?? []).map((f) => [
      f.player_id ?? 0,
      {
        label: f.form_label,
        score: num(f.form_score),
        reasons: Array.isArray(f.form_reasons) ? (f.form_reasons as string[]) : [],
        last4Ppm: num(f.last4_points_per_match),
        seasonPpm: num(f.season_points_per_match),
        last4Xgi90: num(f.last4_xgi90),
        minutesShare: num(f.last4_minutes_share),
        goalsMinusXg: num(f.last4_goals_minus_xg),
      },
    ]),
  );

  const players: PlayerRow[] = (playerRes.data ?? []).map((p) => {
    const photos = playerPhotoUrls(p.fpl_code, p.photo_url_resolved);
    return {
      id: p.id ?? 0,
      webName: p.web_name ?? "?",
      fullName: p.full_name ?? p.web_name ?? "?",
      team: p.team_id != null ? (teams.get(p.team_id) ?? null) : null,
      position: p.fpl_position,
      status: p.status,
      news: p.news,
      priceTenths: p.price_tenths,
      ownedPct: num(p.selected_by_pct),
      photos,
      photosLarge: [...photos].reverse(), // fallback 250x250 lebih besar → dipakai untuk hero
      form: forms.get(p.id ?? 0) ?? null,
    };
  });

  const fixtures: FixtureRow[] = (nextFxRes.data ?? []).map((f) => ({
    id: f.id ?? 0,
    gw: f.gw,
    home: f.home_team_id != null ? (teams.get(f.home_team_id) ?? null) : null,
    away: f.away_team_id != null ? (teams.get(f.away_team_id) ?? null) : null,
    kickoffUtc: f.kickoff_utc,
    status: f.status,
    fdrHome: f.difficulty_home,
    fdrAway: f.difficulty_away,
    recentlyChanged: Boolean(f.recently_changed),
  }));

  const live: FixtureRow[] = (liveRes.data ?? []).map((f) => ({
    id: f.id,
    gw: null,
    home: teams.get(f.home_team_id) ?? null,
    away: teams.get(f.away_team_id) ?? null,
    kickoffUtc: f.kickoff_utc,
    status: f.status,
    fdrHome: null,
    fdrAway: null,
    recentlyChanged: false,
    homeGoals: f.home_goals,
    awayGoals: f.away_goals,
  }));

  return {
    seasonLabel: season?.label ?? null,
    current: gwRes.data?.find((g) => g.is_current) ?? null,
    next: gwRes.data?.find((g) => g.is_next) ?? null,
    fixtures,
    live,
    players,
    standings: computeStandings(resultsRes.data ?? [], teams),
  };
}

/** Klasemen dari hasil fixture final (3/1/0; urut poin, selisih gol, gol). */
export function computeStandings(
  results: { home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null }[],
  teams: Map<number, TeamInfo>,
): StandingRow[] {
  const table = new Map<number, StandingRow>();
  const row = (id: number) => {
    let r = table.get(id);
    if (!r) {
      const team = teams.get(id) ?? { id, name: String(id), short: String(id), badge: null };
      r = { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
      table.set(id, r);
    }
    return r;
  };
  for (const t of teams.keys()) row(t);
  for (const f of results) {
    if (f.home_goals == null || f.away_goals == null) continue;
    const h = row(f.home_team_id);
    const a = row(f.away_team_id);
    h.played++;
    a.played++;
    h.gf += f.home_goals;
    h.ga += f.away_goals;
    a.gf += f.away_goals;
    a.ga += f.home_goals;
    if (f.home_goals > f.away_goals) {
      h.won++;
      h.points += 3;
      a.lost++;
    } else if (f.home_goals < f.away_goals) {
      a.won++;
      a.points += 3;
      h.lost++;
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
    }
  }
  return [...table.values()]
    .filter((r) => r.played > 0 || teams.size <= 20)
    .sort((x, y) => y.points - x.points || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.team.short.localeCompare(y.team.short));
}
