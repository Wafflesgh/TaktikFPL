import "server-only";
import { cache } from "react";
import { playerPhotoUrls } from "@/lib/assets";
import { num, teamMap, toFormInfo, type PlayerRow, type TeamInfo } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";

export type GwRow = {
  fixtureId: number;
  gw: number;
  kickoffUtc: string | null;
  opponent: TeamInfo | null;
  home: boolean | null;
  minutes: number;
  points: number;
  goals: number;
  assists: number;
  bonus: number;
  xg: number | null;
  xa: number | null;
  isFinal: boolean;
};

export type SeasonSummary = {
  seasonId: number;
  label: string;
  isCurrent: boolean;
  teams: TeamInfo[];
  points: number;
  minutes: number;
  appearances: number;
  goals: number;
  assists: number;
  pointsPer90: number | null;
  /** xG + xA; null bila musim itu tidak punya data expected (sebelum 2022/23). */
  xgi: number | null;
};

/** Satu slot grafik per GW musim berjalan (DGW dijumlah). */
export type GwBar = {
  gw: number;
  points: number | null;
  played: boolean;
  finished: boolean;
  label: string;
};

export type ProfilePlayer = PlayerRow & {
  chanceNext: number | null;
  statusAt: string | null;
  inCurrentSeason: boolean;
};

export type PlayerProfile = NonNullable<Awaited<ReturnType<typeof getPlayerProfile>>>;

/** Validasi segmen URL: id pemain = bilangan bulat positif (bigserial). */
export function parsePlayerId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

const STATS_SELECT =
  "fixture_id, minutes, total_points, bonus, goals_scored, assists, expected_goals, expected_assists, is_final, team_id, opponent_team_id, was_home, fixtures(season_id, kickoff_utc, home_team_id, away_team_id), gameweeks(number)";

/**
 * Profil satu pemain: info terkini, form, laga musim ini, dan ringkasan per musim (2016/17–sekarang).
 * null = id tidak dikenal. Dibungkus cache() agar generateMetadata & page berbagi satu fetch.
 */
export const getPlayerProfile = cache(async (id: number) => {
  const supabase = await createClient();

  const [baseRes, seasonsRes] = await Promise.all([
    supabase.from("players").select("id, full_name, web_name, fpl_code, photo_url_resolved").eq("id", id).maybeSingle(),
    supabase.from("seasons").select("id, label, start_date, is_current").order("start_date", { ascending: false }),
  ]);
  const base = baseRes.data;
  if (!base) return null;
  const seasons = seasonsRes.data ?? [];
  const current = seasons.find((s) => s.is_current) ?? null;

  const [curRes, formRes, teamRes, psRes, statsRes, gwRes, liveRes] = await Promise.all([
    supabase
      .from("v_player_current")
      .select("team_id, fpl_position, status, chance_next, news, status_captured_at, price_tenths, selected_by_pct")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("v_player_form")
      .select("form_label, form_score, form_reasons, last4_points_per_match, season_points_per_match, last4_xgi90, last4_minutes_share, last4_goals_minus_xg")
      .eq("player_id", id)
      .maybeSingle(),
    supabase.from("teams").select("id, name, short_name, fpl_team_code"),
    supabase.from("player_seasons").select("season_id, team_id, fpl_position, joined_on").eq("player_id", id),
    supabase.from("player_fpl_gw_stats").select(STATS_SELECT).eq("player_id", id).limit(2000),
    current
      ? supabase.from("gameweeks").select("number, is_finished, is_current").eq("season_id", current.id).order("number")
      : Promise.resolve({ data: [] as { number: number; is_finished: boolean; is_current: boolean }[] }),
    supabase.from("fixtures").select("id", { count: "exact", head: true }).in("status", ["live", "ht"]),
  ]);

  const teams = teamMap(teamRes.data ?? []);
  const team = (tid: number | null | undefined) => (tid != null ? (teams.get(tid) ?? null) : null);
  const cur = curRes.data;
  const memberships = psRes.data ?? [];
  const latestSeasonId = seasons.find((s) => memberships.some((m) => m.season_id === s.id))?.id;
  const latest = memberships.find((m) => m.season_id === latestSeasonId) ?? null;

  const photos = playerPhotoUrls(base.fpl_code, base.photo_url_resolved);
  const player: ProfilePlayer = {
    id: base.id,
    webName: base.web_name,
    fullName: base.full_name,
    team: team(cur?.team_id ?? latest?.team_id),
    position: cur?.fpl_position ?? latest?.fpl_position ?? null,
    status: cur?.status ?? null,
    news: cur?.news || null,
    priceTenths: cur?.price_tenths ?? null,
    ownedPct: num(cur?.selected_by_pct),
    photos,
    photosLarge: [...photos].reverse(),
    form: formRes.data ? toFormInfo(formRes.data) : null,
    chanceNext: cur?.chance_next ?? null,
    statusAt: cur?.status_captured_at ?? null,
    inCurrentSeason: Boolean(cur),
  };

  // Baris statistik → per laga, dengan musim dari fixture.
  const matches = (statsRes.data ?? []).flatMap((r) => {
    const fx = r.fixtures;
    if (!fx) return [];
    let opp = r.opponent_team_id;
    if (opp == null && r.was_home != null) opp = r.was_home ? fx.away_team_id : fx.home_team_id;
    const row: GwRow = {
      fixtureId: r.fixture_id,
      gw: r.gameweeks?.number ?? 0,
      kickoffUtc: fx.kickoff_utc,
      opponent: team(opp),
      home: r.was_home,
      minutes: r.minutes ?? 0,
      points: r.total_points ?? 0,
      goals: r.goals_scored ?? 0,
      assists: r.assists ?? 0,
      bonus: r.bonus ?? 0,
      xg: num(r.expected_goals),
      xa: num(r.expected_assists),
      isFinal: r.is_final,
    };
    return [{ seasonId: fx.season_id, teamId: r.team_id, row }];
  });

  const gws = matches
    .filter((m) => m.seasonId === current?.id)
    .map((m) => m.row)
    .sort((a, b) => a.gw - b.gw || (a.kickoffUtc ?? "").localeCompare(b.kickoffUtc ?? ""));

  // Grafik: satu slot per GW musim ini; 4 GW terakhir yang dimainkan disorot.
  const pointsByGw = new Map<number, number>();
  for (const g of gws) pointsByGw.set(g.gw, (pointsByGw.get(g.gw) ?? 0) + g.points);
  const lastFour = new Set([...pointsByGw.keys()].sort((a, b) => a - b).slice(-4));
  const gwLabels = new Map<number, string>();
  for (const g of gws) {
    const vs = `${g.opponent?.short ?? "?"}${g.home == null ? "" : g.home ? " (H)" : " (A)"}`;
    gwLabels.set(g.gw, gwLabels.has(g.gw) ? `${gwLabels.get(g.gw)} + ${vs}` : vs);
  }
  const bars: GwBar[] = (gwRes.data ?? []).map((g) => ({
    gw: g.number,
    points: pointsByGw.get(g.number) ?? null,
    played: pointsByGw.has(g.number),
    finished: g.is_finished || g.is_current,
    label: gwLabels.get(g.number) ?? "",
  }));

  const seasonSummaries: SeasonSummary[] = seasons.flatMap((s) => {
    const rows = matches.filter((m) => m.seasonId === s.id);
    const memberTeams = memberships
      .filter((m) => m.season_id === s.id)
      .sort((a, b) => (a.joined_on ?? "").localeCompare(b.joined_on ?? ""))
      .map((m) => m.team_id);
    if (rows.length === 0 && memberTeams.length === 0) return [];
    const teamIds = memberTeams.length > 0 ? memberTeams : [...new Set(rows.map((m) => m.teamId).filter((t) => t != null))];
    const sum = (f: (r: GwRow) => number) => rows.reduce((acc, m) => acc + f(m.row), 0);
    const withXg = rows.filter((m) => m.row.xg != null || m.row.xa != null);
    const minutes = sum((r) => r.minutes);
    const points = sum((r) => r.points);
    return [
      {
        seasonId: s.id,
        label: s.label,
        isCurrent: s.is_current,
        teams: [...new Set(teamIds)].map(team).filter((t): t is TeamInfo => t != null),
        points,
        minutes,
        appearances: rows.filter((m) => m.row.minutes > 0).length,
        goals: sum((r) => r.goals),
        assists: sum((r) => r.assists),
        pointsPer90: minutes > 0 ? (points / minutes) * 90 : null,
        xgi: withXg.length > 0 ? withXg.reduce((acc, m) => acc + (m.row.xg ?? 0) + (m.row.xa ?? 0), 0) : null,
      },
    ];
  });

  return {
    player,
    seasonLabel: current?.label ?? null,
    gws,
    lastFour,
    bars,
    seasons: seasonSummaries,
    thisSeason: seasonSummaries.find((s) => s.isCurrent) ?? null,
    liveCount: liveRes.count ?? 0,
  };
});
