import "server-only";
import { teamBadgeUrl } from "@/lib/assets";
import type { TeamInfo } from "@/lib/data/dashboard";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const TICKER_SPAN = 6;
/** Nilai FDR untuk GW tanpa laga (blank): setara lawan tersulit karena tidak ada poin. */
export const BLANK_FDR = 5;
const CHANGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type GameweekInfo = {
  number: number;
  deadlineUtc: string;
  isCurrent: boolean;
  isNext: boolean;
  isFinished: boolean;
  isBlank: boolean;
  isDouble: boolean;
};

export type TickerFixture = { id: number; opponent: TeamInfo | null; home: boolean; fdr: number | null };

export type TickerRow = {
  team: TeamInfo;
  /** Satu entri per GW di `tickerGws`; array kosong = blank GW. */
  cells: TickerFixture[][];
  /** Jumlah FDR per GW (double = rata-rata laganya, blank = BLANK_FDR); makin kecil makin mudah. */
  total: number;
};

export type FixtureChange = { type: string; detectedAt: string; oldValue: Json | null; newValue: Json | null };

export type GwFixture = {
  id: number;
  home: TeamInfo | null;
  away: TeamInfo | null;
  kickoffUtc: string | null;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
  fdrHome: number | null;
  fdrAway: number | null;
  /** Perubahan terbaru dalam 7 hari terakhir (null bila tidak ada). */
  change: FixtureChange | null;
};

export type JadwalData = Awaited<ReturnType<typeof getJadwalData>>;

// Laga yang tidak jadi dimainkan tidak dihitung di ticker (sama dengan v_gw_team_fixture_counts).
const NOT_PLAYED = new Set(["postponed", "cancelled"]);

/** Data halaman Jadwal: ticker FDR 6 GW + daftar laga satu GW (RLS: pengguna login). */
export async function getJadwalData(requestedGw: number | undefined) {
  const supabase = await createClient();
  const { data: season } = await supabase.from("seasons").select("id, label").eq("is_current", true).maybeSingle();
  if (!season) {
    return { seasonLabel: null, gameweeks: [], tickerGws: [], ticker: [], selectedGw: null, fixtures: [], liveCount: 0 };
  }

  const [gwRes, memberRes, teamRes, liveRes] = await Promise.all([
    supabase
      .from("gameweeks")
      .select("id, number, deadline_utc, is_current, is_next, is_finished, is_blank, is_double")
      .eq("season_id", season.id)
      .order("number"),
    supabase.from("team_seasons").select("team_id").eq("season_id", season.id).eq("league_code", "PL").not("fpl_team_id", "is", null),
    supabase.from("teams").select("id, name, short_name, fpl_team_code"),
    supabase.from("fixtures").select("id", { count: "exact", head: true }).eq("season_id", season.id).in("status", ["live", "ht"]),
  ]);

  const teams = new Map<number, TeamInfo>(
    (teamRes.data ?? []).map((t) => [
      t.id,
      { id: t.id, name: t.name, short: t.short_name ?? t.name.slice(0, 3).toUpperCase(), badge: teamBadgeUrl(t.fpl_team_code) },
    ]),
  );

  const gwRows = gwRes.data ?? [];
  const gameweeks: GameweekInfo[] = gwRows.map((g) => ({
    number: g.number,
    deadlineUtc: g.deadline_utc,
    isCurrent: g.is_current,
    isNext: g.is_next,
    isFinished: g.is_finished,
    isBlank: g.is_blank,
    isDouble: g.is_double,
  }));
  const anchor = gwRows.find((g) => g.is_next) ?? gwRows.find((g) => g.is_current) ?? gwRows[0] ?? null;
  const tickerRows = anchor ? gwRows.filter((g) => g.number >= anchor.number).slice(0, TICKER_SPAN) : [];
  const selected = gwRows.find((g) => g.number === requestedGw) ?? anchor;

  const gwIds = new Set([...tickerRows.map((g) => g.id), ...(selected ? [selected.id] : [])]);
  const { data: fxData } = gwIds.size
    ? await supabase
        .from("fixtures")
        .select("id, gameweek_id, home_team_id, away_team_id, kickoff_utc, status, home_goals, away_goals, difficulty_home, difficulty_away")
        .in("gameweek_id", [...gwIds])
        .order("kickoff_utc", { nullsFirst: false })
    : { data: [] };
  const fixtures = fxData ?? [];

  // Ticker: baris = tim PL musim ini, kolom = GW; double = beberapa laga, blank = sel kosong.
  const tickerGws = tickerRows.map((g) => g.number);
  const colOf = new Map(tickerRows.map((g, i) => [g.id, i]));
  const memberIds = (memberRes.data ?? []).map((m) => m.team_id);
  const cellsByTeam = new Map<number, TickerFixture[][]>(memberIds.map((id) => [id, tickerGws.map(() => [])]));
  for (const f of fixtures) {
    const col = f.gameweek_id != null ? colOf.get(f.gameweek_id) : undefined;
    if (col == null || NOT_PLAYED.has(f.status)) continue;
    cellsByTeam.get(f.home_team_id)?.[col].push({ id: f.id, opponent: teams.get(f.away_team_id) ?? null, home: true, fdr: f.difficulty_home });
    cellsByTeam.get(f.away_team_id)?.[col].push({ id: f.id, opponent: teams.get(f.home_team_id) ?? null, home: false, fdr: f.difficulty_away });
  }
  const ticker: TickerRow[] = [...cellsByTeam.entries()].map(([id, cells]) => ({
    team: teams.get(id) ?? { id, name: String(id), short: String(id), badge: null },
    cells,
    total: cells.reduce((sum, cell) => sum + cellFdr(cell), 0),
  }));

  // Daftar laga GW terpilih + perubahan jadwal 7 hari terakhir.
  const gwFixtures = selected ? fixtures.filter((f) => f.gameweek_id === selected.id) : [];
  const since = new Date(Date.now() - CHANGE_WINDOW_MS).toISOString();
  const { data: changeData } = gwFixtures.length
    ? await supabase
        .from("fixture_changes")
        .select("fixture_id, change_type, detected_at, old_value, new_value")
        .in("fixture_id", gwFixtures.map((f) => f.id))
        .gte("detected_at", since)
        .order("detected_at", { ascending: false })
    : { data: [] };
  const latestChange = new Map<number, FixtureChange>();
  for (const c of changeData ?? []) {
    if (latestChange.has(c.fixture_id)) continue;
    latestChange.set(c.fixture_id, { type: c.change_type, detectedAt: c.detected_at, oldValue: c.old_value, newValue: c.new_value });
  }

  return {
    seasonLabel: season.label,
    gameweeks,
    tickerGws,
    ticker,
    selectedGw: selected?.number ?? null,
    fixtures: gwFixtures.map(
      (f): GwFixture => ({
        id: f.id,
        home: teams.get(f.home_team_id) ?? null,
        away: teams.get(f.away_team_id) ?? null,
        kickoffUtc: f.kickoff_utc,
        status: f.status,
        homeGoals: f.home_goals,
        awayGoals: f.away_goals,
        fdrHome: f.difficulty_home,
        fdrAway: f.difficulty_away,
        change: latestChange.get(f.id) ?? null,
      }),
    ),
    liveCount: liveRes.count ?? 0,
  };
}

/** Nilai FDR satu sel ticker: rata-rata laga (FDR kosong dianggap 3), blank = BLANK_FDR. */
export function cellFdr(cell: TickerFixture[]): number {
  if (cell.length === 0) return BLANK_FDR;
  return cell.reduce((sum, f) => sum + (f.fdr ?? 3), 0) / cell.length;
}
