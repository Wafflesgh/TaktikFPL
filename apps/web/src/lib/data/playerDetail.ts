import "server-only";
import { playerPhotoUrls } from "@/lib/assets";
import { num, teamMap, type TeamInfo } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";

/** Statistik pemain di satu slot posisi Understat (atau "Sub" = masuk dari bangku). */
export type PositionStat = {
  pos: string;
  apps: number;
  minutes: number;
  goals: number;
  assists: number;
  xg: number;
  xa: number;
  /** Poin FPL total di laga-laga pada posisi ini (rata-rata = points / apps). */
  points: number;
};

export type PositionSeason = { seasonId: number; label: string; positions: PositionStat[] };

/**
 * Posisi per laga dari lineups Understat (2025/26 →), digabung dengan G/A/xG/xA laga itu.
 * Satu baris lineups = satu penampilan (Understat hanya mencatat pemain yang bermain).
 */
export async function getPlayerPositions(playerId: number): Promise<{ seasons: PositionSeason[]; byFixture: Map<number, string> }> {
  const supabase = await createClient();
  const [luRes, stRes, seasonRes, ptsRes] = await Promise.all([
    supabase.from("lineups").select("fixture_id, position_label, fixtures(season_id)").eq("player_id", playerId).limit(1000),
    supabase.from("player_match_stats").select("fixture_id, minutes, goals, assists, xg, xa").eq("player_id", playerId).limit(1000),
    supabase.from("seasons").select("id, label"),
    supabase.from("player_fpl_gw_stats").select("fixture_id, total_points").eq("player_id", playerId).limit(2000),
  ]);
  const stats = new Map((stRes.data ?? []).map((s) => [s.fixture_id, s]));
  const points = new Map((ptsRes.data ?? []).map((p) => [p.fixture_id, p.total_points ?? 0]));
  const byFixture = new Map<number, string>();
  const labels = new Map((seasonRes.data ?? []).map((s) => [s.id, s.label]));
  const bySeason = new Map<number, Map<string, PositionStat>>();
  for (const l of luRes.data ?? []) {
    const sid = l.fixtures?.season_id;
    const pos = l.position_label;
    if (sid == null || !pos) continue;
    byFixture.set(l.fixture_id, pos);
    const s = stats.get(l.fixture_id);
    const slots = bySeason.get(sid) ?? new Map<string, PositionStat>();
    bySeason.set(sid, slots);
    const p = slots.get(pos) ?? { pos, apps: 0, minutes: 0, goals: 0, assists: 0, xg: 0, xa: 0, points: 0 };
    p.apps += 1;
    p.points += points.get(l.fixture_id) ?? 0;
    p.minutes += s?.minutes ?? 0;
    p.goals += s?.goals ?? 0;
    p.assists += s?.assists ?? 0;
    p.xg += num(s?.xg) ?? 0;
    p.xa += num(s?.xa) ?? 0;
    slots.set(pos, p);
  }
  const seasons = [...bySeason.entries()]
    .map(([seasonId, slots]) => ({
      seasonId,
      label: labels.get(seasonId) ?? String(seasonId),
      positions: [...slots.values()].sort((a, b) => b.apps - a.apps),
    }))
    .sort((a, b) => b.label.localeCompare(a.label));
  return { seasons, byFixture };
}

/** Total musim berjalan: statistik FPL + Understat (tembakan, key pass, npxG, xGChain, xGBuildup). */
export type SeasonDetail = {
  matches: number;
  appearances: number;
  starts: number;
  minutes: number;
  fpl: Record<string, number>;
  understat: Record<string, number> | null;
};

const FPL_KEYS = [
  "total_points",
  "goals_scored",
  "assists",
  "expected_goals",
  "expected_assists",
  "bonus",
  "bps",
  "clean_sheets",
  "goals_conceded",
  "expected_goals_conceded",
  "saves",
  "penalties_saved",
  "penalties_missed",
  "own_goals",
  "yellow_cards",
  "red_cards",
  "defensive_contribution",
  "defcon_points",
  "influence",
  "creativity",
  "threat",
  "ict_index",
] as const;

export async function getSeasonDetail(playerId: number, seasonId: number): Promise<SeasonDetail> {
  const supabase = await createClient();
  const [fplRes, usRes] = await Promise.all([
    supabase
      .from("player_fpl_gw_stats")
      .select(`minutes, starts, ${FPL_KEYS.join(", ")}, fixtures!inner(season_id)`)
      .eq("player_id", playerId)
      .eq("fixtures.season_id", seasonId)
      .limit(1000),
    supabase
      .from("player_match_stats")
      .select("minutes, goals, assists, shots, key_passes, xg, npxg, xa, extra, fixtures!inner(season_id)")
      .eq("player_id", playerId)
      .eq("fixtures.season_id", seasonId)
      .limit(1000),
  ]);
  const rows = (fplRes.data ?? []) as unknown as Record<string, unknown>[];
  const fpl: Record<string, number> = {};
  for (const k of FPL_KEYS) fpl[k] = rows.reduce((acc, r) => acc + (num(r[k] as number | string | null) ?? 0), 0);
  const us = usRes.data ?? [];
  let understat: Record<string, number> | null = null;
  if (us.length > 0) {
    const extra = (r: (typeof us)[number], k: string) => {
      const e = r.extra as Record<string, unknown> | null;
      return typeof e?.[k] === "number" ? (e[k] as number) : 0;
    };
    understat = {
      shots: us.reduce((a, r) => a + (r.shots ?? 0), 0),
      key_passes: us.reduce((a, r) => a + (r.key_passes ?? 0), 0),
      npxg: us.reduce((a, r) => a + (num(r.npxg) ?? 0), 0),
      xg: us.reduce((a, r) => a + (num(r.xg) ?? 0), 0),
      xa: us.reduce((a, r) => a + (num(r.xa) ?? 0), 0),
      xg_chain: us.reduce((a, r) => a + extra(r, "xg_chain"), 0),
      xg_buildup: us.reduce((a, r) => a + extra(r, "xg_buildup"), 0),
      minutes: us.reduce((a, r) => a + (r.minutes ?? 0), 0),
    };
  }
  return {
    matches: rows.length,
    appearances: rows.filter((r) => Number(r.minutes ?? 0) > 0).length,
    starts: rows.reduce((acc, r) => acc + Number(r.starts ?? 0), 0),
    minutes: rows.reduce((acc, r) => acc + Number(r.minutes ?? 0), 0),
    fpl,
    understat,
  };
}

/** Satu pemain di posisi FPL yang sama: form (last4) + statistik musim (snapshot build_form). */
export type Peer = {
  id: number;
  webName: string;
  team: TeamInfo | null;
  priceTenths: number | null;
  ownedPct: number | null;
  status: string | null;
  photos: string[];
  formLabel: string | null;
  formScore: number | null;
  last4Ppm: number | null;
  minutesShare: number | null;
  season: {
    points: number;
    minutes: number;
    appearances: number;
    goals: number;
    assists: number;
    xg: number;
    xa: number;
    bonus: number;
    cleanSheets: number;
    pointsPerMatch: number | null;
    points90: number | null;
    xg90: number | null;
    xa90: number | null;
    xgi90: number | null;
    defcon90: number | null;
    goalsMinusXg: number | null;
  } | null;
};

const n0 = (v: unknown) => (typeof v === "number" ? v : 0);
const nn = (v: unknown) => (typeof v === "number" ? v : null);

export async function getPositionPeers(position: string): Promise<Peer[]> {
  const supabase = await createClient();
  const [curRes, teamRes] = await Promise.all([
    supabase
      .from("v_player_current")
      .select("id, web_name, fpl_code, photo_url_resolved, team_id, status, price_tenths, selected_by_pct")
      .eq("fpl_position", position)
      .limit(1000),
    supabase.from("teams").select("id, name, short_name, fpl_team_code"),
  ]);
  const players = (curRes.data ?? []).filter((p) => p.id != null);
  const ids = players.map((p) => p.id as number);
  if (ids.length === 0) return [];
  const formRes = await supabase
    .from("v_player_form")
    .select("player_id, as_of, form_label, form_score, last4_points_per_match, last4_minutes_share")
    .in("player_id", ids)
    .limit(1000);
  const forms = new Map((formRes.data ?? []).map((f) => [f.player_id, f]));
  const asOfs = [...new Set((formRes.data ?? []).map((f) => f.as_of).filter((a): a is string => a != null))];
  const seasonRes = asOfs.length
    ? await supabase
        .from("player_form_features")
        .select("player_id, as_of, metrics")
        .eq("window_label", "season")
        .in("player_id", ids)
        .in("as_of", asOfs)
        .limit(2000)
    : { data: [] as { player_id: number; as_of: string; metrics: unknown }[] };
  const seasonBy = new Map<number, Record<string, unknown>>();
  for (const r of seasonRes.data ?? []) {
    if (forms.get(r.player_id)?.as_of === r.as_of) seasonBy.set(r.player_id, r.metrics as Record<string, unknown>);
  }
  const teams = teamMap(teamRes.data ?? []);
  return players.map((p) => {
    const f = forms.get(p.id);
    const m = seasonBy.get(p.id as number);
    return {
      id: p.id as number,
      webName: p.web_name ?? "?",
      team: p.team_id != null ? (teams.get(p.team_id) ?? null) : null,
      priceTenths: p.price_tenths,
      ownedPct: num(p.selected_by_pct),
      status: p.status,
      photos: playerPhotoUrls(p.fpl_code, p.photo_url_resolved),
      formLabel: f?.form_label ?? null,
      formScore: num(f?.form_score),
      last4Ppm: num(f?.last4_points_per_match),
      minutesShare: num(f?.last4_minutes_share),
      season: m
        ? {
            points: n0(m.points),
            minutes: n0(m.minutes),
            appearances: n0(m.appearances),
            goals: n0(m.goals),
            assists: n0(m.assists),
            xg: n0(m.xg),
            xa: n0(m.xa),
            bonus: n0(m.bonus),
            cleanSheets: n0(m.clean_sheets),
            pointsPerMatch: nn(m.points_per_match),
            points90: nn(m.points90),
            xg90: nn(m.xg90),
            xa90: nn(m.xa90),
            xgi90: nn(m.xgi90),
            defcon90: nn(m.defcon90),
            goalsMinusXg: nn(m.goals_minus_xg),
          }
        : null,
    };
  });
}
