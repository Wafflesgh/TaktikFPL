import "server-only";
import { cache } from "react";
import { num, teamMap, type TeamInfo } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";

/** Fixture liga (musim berjalan + musim lalu) dari sudut netral. */
export type Fx = {
  id: number;
  seasonId: number;
  gw: number | null;
  homeId: number;
  awayId: number;
  kickoffUtc: string | null;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
  fdrHome: number | null;
  fdrAway: number | null;
};

/** Statistik Understat satu tim di satu laga. */
export type TeamMatchStat = {
  xg: number | null;
  xga: number | null;
  ppda: number | null; // umpan lawan per aksi bertahan: tinggi = bertahan dalam / pasif
  ppdaAllowed: number | null;
  deep: number | null; // umpan selesai ≤20 m dari gawang lawan
  deepAllowed: number | null;
};

/** Laga dari sudut pandang satu tim. */
export type TeamRow = {
  fx: Fx;
  oppId: number;
  home: boolean;
  gf: number | null;
  ga: number | null;
  result: "W" | "D" | "L" | null;
  fdr: number | null;
  stat: TeamMatchStat | null;
  oppStat: TeamMatchStat | null;
};

/** Gaya tim (snapshot worker, 19 laga terakhir) + peringkat di antara tim musim berjalan (1 = teratas). */
export type Style = {
  matches: number;
  ppda: number;
  deep: number;
  deepAllowed: number;
  xg: number;
  xga: number;
  bucket: "low_block" | "high_press" | "mid_block";
  rankPress: number; // 1 = pressing paling agresif (PPDA terendah)
  rankAttack: number; // 1 = xG tertinggi
  rankDefence: number; // 1 = xGA terendah
  rankTerritory: number; // 1 = deep completions tertinggi
  rankDeepAllowed: number; // 1 = paling sedikit membiarkan lawan masuk sepertiga akhir
  n: number;
};

const PAGE = 1000;

/** PostgREST memotong 1000 baris → ambil per halaman. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await page(from, from + PAGE - 1);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function rankBy(ids: number[], value: (id: number) => number, asc: boolean): Map<number, number> {
  const sorted = [...ids].sort((a, b) => (asc ? value(a) - value(b) : value(b) - value(a)));
  return new Map(sorted.map((id, i) => [id, i + 1]));
}

function toStat(r: { xg: number | null; xga: number | null; ppda: number | null; deep_completions: number | null; extra: unknown }): TeamMatchStat {
  const e = (r.extra ?? {}) as Record<string, unknown>;
  return {
    xg: num(r.xg),
    xga: num(r.xga),
    ppda: num(r.ppda),
    ppdaAllowed: num(e.ppda_allowed),
    deep: num(r.deep_completions),
    deepAllowed: num(e.deep_allowed),
  };
}

/** Data liga bersama untuk halaman pemain & klub (satu kali per request). */
export const getLeague = cache(async () => {
  const supabase = await createClient();
  const [seasonRes, teamRes] = await Promise.all([
    supabase.from("seasons").select("id, label, is_current, start_date").order("start_date", { ascending: false }).limit(2),
    supabase.from("teams").select("id, name, short_name, fpl_team_code"),
  ]);
  const seasons = seasonRes.data ?? [];
  const current = seasons.find((s) => s.is_current) ?? seasons[0] ?? null;
  const seasonIds = seasons.map((s) => s.id);
  const teams = teamMap(teamRes.data ?? []);

  const [memberRes, fxRows, gwRes, styleRes] = await Promise.all([
    current ? supabase.from("team_seasons").select("team_id").eq("season_id", current.id) : Promise.resolve({ data: [] }),
    fetchAll((a, b) =>
      supabase
        .from("fixtures")
        .select("id, season_id, gameweek_id, home_team_id, away_team_id, kickoff_utc, status, home_goals, away_goals, difficulty_home, difficulty_away")
        .in("season_id", seasonIds)
        .order("id")
        .range(a, b),
    ),
    supabase.from("gameweeks").select("id, number").in("season_id", seasonIds),
    supabase.from("team_style_profiles").select("team_id, as_of, metrics").eq("window_label", "last19").order("as_of", { ascending: false }).limit(200),
  ]);
  const gwNumber = new Map((gwRes.data ?? []).map((g) => [g.id, g.number]));
  const fixtures: Fx[] = fxRows
    .map((f) => ({
      id: f.id,
      seasonId: f.season_id,
      gw: f.gameweek_id != null ? (gwNumber.get(f.gameweek_id) ?? null) : null,
      homeId: f.home_team_id,
      awayId: f.away_team_id,
      kickoffUtc: f.kickoff_utc,
      status: f.status,
      homeGoals: f.home_goals,
      awayGoals: f.away_goals,
      fdrHome: f.difficulty_home,
      fdrAway: f.difficulty_away,
    }))
    .sort((a, b) => (a.kickoffUtc ?? "9").localeCompare(b.kickoffUtc ?? "9"));

  const finishedIds = fixtures.filter((f) => f.status === "finished").map((f) => f.id);
  const tmsRows = await fetchAll((a, b) =>
    supabase
      .from("team_match_stats")
      .select("fixture_id, team_id, xg, xga, ppda, deep_completions, extra")
      .eq("source", "understat")
      .in("fixture_id", finishedIds)
      .order("fixture_id")
      .range(a, b),
  );
  const stats = new Map<string, TeamMatchStat>();
  for (const r of tmsRows) stats.set(`${r.fixture_id}:${r.team_id}`, toStat(r));

  const currentTeamIds = (memberRes.data ?? []).map((m) => m.team_id);
  const latestAsOf = styleRes.data?.[0]?.as_of;
  const raw = new Map<number, Record<string, unknown>>();
  for (const s of styleRes.data ?? []) if (s.as_of === latestAsOf) raw.set(s.team_id, s.metrics as Record<string, unknown>);
  const ids = currentTeamIds.filter((t) => raw.has(t));
  const m = (id: number, k: string) => Number(raw.get(id)?.[k] ?? 0);
  const ranks = {
    press: rankBy(ids, (t) => m(t, "ppda"), true),
    attack: rankBy(ids, (t) => m(t, "xg"), false),
    defence: rankBy(ids, (t) => m(t, "xga"), true),
    territory: rankBy(ids, (t) => m(t, "deep"), false),
    deepAllowed: rankBy(ids, (t) => m(t, "deep_allowed"), true),
  };
  const styles = new Map<number, Style>(
    ids.map((t) => [
      t,
      {
        matches: m(t, "matches"),
        ppda: m(t, "ppda"),
        deep: m(t, "deep"),
        deepAllowed: m(t, "deep_allowed"),
        xg: m(t, "xg"),
        xga: m(t, "xga"),
        bucket: (raw.get(t)?.bucket as Style["bucket"]) ?? "mid_block",
        rankPress: ranks.press.get(t) ?? 0,
        rankAttack: ranks.attack.get(t) ?? 0,
        rankDefence: ranks.defence.get(t) ?? 0,
        rankTerritory: ranks.territory.get(t) ?? 0,
        rankDeepAllowed: ranks.deepAllowed.get(t) ?? 0,
        n: ids.length,
      },
    ]),
  );

  return { season: current, seasonIds, teams, currentTeamIds, fixtures, stats, styles, styleAsOf: latestAsOf ?? null };
});

export type League = Awaited<ReturnType<typeof getLeague>>;

/** Semua laga satu tim (urut kickoff) dari sudut pandang tim itu. */
export function teamRows(league: League, teamId: number): TeamRow[] {
  return league.fixtures
    .filter((f) => f.homeId === teamId || f.awayId === teamId)
    .map((fx) => {
      const home = fx.homeId === teamId;
      const oppId = home ? fx.awayId : fx.homeId;
      const gf = home ? fx.homeGoals : fx.awayGoals;
      const ga = home ? fx.awayGoals : fx.homeGoals;
      const done = fx.status === "finished" && gf != null && ga != null;
      return {
        fx,
        oppId,
        home,
        gf: done ? gf : null,
        ga: done ? ga : null,
        result: done ? (gf! > ga! ? "W" : gf! < ga! ? "L" : "D") : null,
        fdr: home ? fx.fdrHome : fx.fdrAway,
        stat: league.stats.get(`${fx.id}:${teamId}`) ?? null,
        oppStat: league.stats.get(`${fx.id}:${oppId}`) ?? null,
      };
    });
}

export const teamOf = (league: League, id: number): TeamInfo =>
  league.teams.get(id) ?? { id, name: String(id), short: String(id), badge: null };

