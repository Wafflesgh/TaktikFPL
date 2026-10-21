import "server-only";
import { reviewMatch, type Review, type ShotRow } from "@/lib/analysis/matchReview";
import { usualXi, type UsualXi } from "@/lib/analysis/xi";
import { computeStandings, type TeamInfo } from "@/lib/data/dashboard";
import { fetchAll, getLeague, teamOf, teamRows, type Style, type TeamRow } from "@/lib/data/league";
import { getPlayerCards, getRecentLineups, type PlayerCard } from "@/lib/data/squad";
import { createClient } from "@/lib/supabase/server";

const XI_WINDOW = 8;
const REVIEWS = 6;
const SET_PIECE = new Set(["FromCorner", "SetPiece", "DirectFreekick"]);

export type Coach = {
  name: string;
  photoUrl: string | null;
  nationality: string | null;
  birthDate: string | null;
  age: number | null;
  since: string;
  wikidataUrl: string | null;
  record: { played: number; won: number; drawn: number; lost: number; ppg: number | null; xgFor: number | null; xgAgainst: number | null };
  predecessor: { name: string; ppg: number | null; played: number } | null;
};

export type SeasonRecord = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  cleanSheets: number;
  xg: number | null;
  xga: number | null;
  ppda: number | null;
  home: { played: number; points: number; gf: number; ga: number };
  away: { played: number; points: number; gf: number; ga: number };
};

export type ShotProfile = {
  shotsFor: number;
  shotsAgainst: number;
  xgPerShot: number | null;
  xgPerShotAgainst: number | null;
  setPieceShareFor: number | null; // porsi xG dari bola mati
  setPieceShareAgainst: number | null;
  crossShareFor: number | null; // porsi tembakan setelah umpan silang
  matches: number;
};

export type ReviewRow = { row: TeamRow; opp: TeamInfo; review: Review };

const pts = (r: TeamRow) => (r.result === "W" ? 3 : r.result === "D" ? 1 : 0);
const sumN = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);

function record(rows: TeamRow[]): SeasonRecord {
  const done = rows.filter((r) => r.result != null);
  const split = (home: boolean) => {
    const xs = done.filter((r) => r.home === home);
    return { played: xs.length, points: xs.reduce((a, r) => a + pts(r), 0), gf: xs.reduce((a, r) => a + (r.gf ?? 0), 0), ga: xs.reduce((a, r) => a + (r.ga ?? 0), 0) };
  };
  const withStat = done.filter((r) => r.stat);
  const ppdas = withStat.map((r) => r.stat!.ppda).filter((v): v is number => v != null);
  return {
    played: done.length,
    won: done.filter((r) => r.result === "W").length,
    drawn: done.filter((r) => r.result === "D").length,
    lost: done.filter((r) => r.result === "L").length,
    gf: done.reduce((a, r) => a + (r.gf ?? 0), 0),
    ga: done.reduce((a, r) => a + (r.ga ?? 0), 0),
    points: done.reduce((a, r) => a + pts(r), 0),
    cleanSheets: done.filter((r) => r.ga === 0).length,
    xg: sumN(withStat.map((r) => r.stat!.xg)),
    xga: sumN(withStat.map((r) => r.stat!.xga)),
    ppda: ppdas.length ? ppdas.reduce((a, v) => a + v, 0) / ppdas.length : null,
    home: split(true),
    away: split(false),
  };
}

function shotProfile(shots: (ShotRow & { fixture_id: number })[], teamId: number, matches: number): ShotProfile {
  const mine = shots.filter((s) => s.team_id === teamId);
  const theirs = shots.filter((s) => s.team_id != null && s.team_id !== teamId);
  const xg = (xs: ShotRow[]) => xs.reduce((a, s) => a + (s.xg ?? 0), 0);
  const share = (xs: ShotRow[], pred: (s: ShotRow) => boolean) => (xg(xs) > 0 ? xg(xs.filter(pred)) / xg(xs) : null);
  return {
    shotsFor: mine.length,
    shotsAgainst: theirs.length,
    xgPerShot: mine.length ? xg(mine) / mine.length : null,
    xgPerShotAgainst: theirs.length ? xg(theirs) / theirs.length : null,
    setPieceShareFor: share(mine, (s) => SET_PIECE.has(s.situation ?? "")),
    setPieceShareAgainst: share(theirs, (s) => SET_PIECE.has(s.situation ?? "")),
    crossShareFor: mine.length ? mine.filter((s) => (s as { last_action?: string | null }).last_action === "Cross").length / mine.length : null,
    matches,
  };
}

async function getCoach(teamId: number, rows: TeamRow[]): Promise<Coach | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("manager_tenures")
    .select("start_date, end_date, source_url, managers(full_name, photo_url, nationality, birth_date, wikidata_id)")
    .eq("team_id", teamId)
    .order("start_date", { ascending: false })
    .limit(2);
  const cur = data?.[0];
  if (!cur || cur.end_date != null || !cur.managers) return null;
  const since = cur.start_date;
  const under = rows.filter((r) => r.result != null && (r.fx.kickoffUtc ?? "") >= since);
  const st = under.filter((r) => r.stat);
  const before = rows.filter((r) => r.result != null && (r.fx.kickoffUtc ?? "") < since && (!data[1] || (r.fx.kickoffUtc ?? "") >= data[1].start_date));
  const ppg = (xs: TeamRow[]) => (xs.length ? xs.reduce((a, r) => a + pts(r), 0) / xs.length : null);
  return {
    name: cur.managers.full_name,
    photoUrl: cur.managers.photo_url,
    nationality: cur.managers.nationality,
    birthDate: cur.managers.birth_date,
    age: cur.managers.birth_date ? Math.floor((Date.now() - Date.parse(cur.managers.birth_date)) / (365.25 * 864e5)) : null,
    since,
    wikidataUrl: cur.managers.wikidata_id ? `https://www.wikidata.org/wiki/${cur.managers.wikidata_id}` : null,
    record: {
      played: under.length,
      won: under.filter((r) => r.result === "W").length,
      drawn: under.filter((r) => r.result === "D").length,
      lost: under.filter((r) => r.result === "L").length,
      ppg: ppg(under),
      xgFor: st.length ? st.reduce((a, r) => a + (r.stat!.xg ?? 0), 0) / st.length : null,
      xgAgainst: st.length ? st.reduce((a, r) => a + (r.stat!.xga ?? 0), 0) / st.length : null,
    },
    predecessor:
      data[1]?.managers && before.length ? { name: data[1].managers.full_name, ppg: ppg(before), played: before.length } : null,
  };
}

/** Profil klub: XI utama & formasi, gaya, pelatih, rekor musim, jadwal, dan review laga terakhir. */
export async function getClub(teamId: number) {
  const league = await getLeague();
  const team = league.teams.get(teamId);
  if (!team) return null;
  const all = teamRows(league, teamId);
  const seasonId = league.season?.id;
  const season = all.filter((r) => r.fx.seasonId === seasonId);
  const finished = season.filter((r) => r.result != null);
  const upcoming = season.filter((r) => r.result == null && r.fx.status !== "cancelled");

  const lineups = await getRecentLineups(league, [teamId], Math.max(XI_WINDOW, REVIEWS));
  const lu = lineups.get(teamId);
  const xi: UsualXi | null = lu ? usualXi(lu.rows, lu.order.slice(0, XI_WINDOW)) : null;
  const xiAll: UsualXi | null = lu ? usualXi(lu.rows, lu.order) : null;

  const supabase = await createClient();
  const reviewRows = finished.slice(-REVIEWS).reverse();
  const seasonFx = finished.map((r) => r.fx.id);
  const [shots, redRes, coach] = await Promise.all([
    seasonFx.length
      ? fetchAll((a, b) =>
          supabase.from("shots").select("fixture_id, team_id, minute, xg, result, situation, last_action").in("fixture_id", seasonFx).order("id").range(a, b),
        )
      : Promise.resolve([]),
    reviewRows.length
      ? supabase.from("player_fpl_gw_stats").select("fixture_id, player_id, team_id").in("fixture_id", reviewRows.map((r) => r.fx.id)).gt("red_cards", 0)
      : Promise.resolve({ data: [] as { fixture_id: number; player_id: number; team_id: number | null }[] }),
    getCoach(teamId, all),
  ]);

  const cardIds = [...(xi?.players.map((p) => p.playerId) ?? []), ...(redRes.data ?? []).map((r) => r.player_id)];
  const cards = await getPlayerCards(cardIds);
  const name = (id: number) => cards.get(id)?.webName ?? String(id);

  const standings = computeStandings(
    league.fixtures
      .filter((f) => f.seasonId === seasonId && f.status === "finished")
      .map((f) => ({ home_team_id: f.homeId, away_team_id: f.awayId, home_goals: f.homeGoals, away_goals: f.awayGoals })),
    new Map(league.currentTeamIds.map((id) => [id, teamOf(league, id)])),
  );
  const tablePos = new Map(standings.map((s, i) => [s.team.id, i + 1]));
  const style: Style | null = league.styles.get(teamId) ?? null;
  // Pemain inti = XI utama dari seluruh jendela; "absen" bila tidak start di laga itu (dan punya lineup).
  const regulars = (xiAll ?? xi)?.players ?? [];

  const reviews: ReviewRow[] = reviewRows.map((row) => {
    const starters = xiAll?.startersBy.get(row.fx.id);
    const missing = starters ? regulars.filter((p) => p.starts >= 3 && !starters.has(p.playerId)).map((p) => name(p.playerId)) : [];
    const reds = (redRes.data ?? []).filter((r) => r.fixture_id === row.fx.id);
    const opp = teamOf(league, row.oppId);
    return {
      row,
      opp,
      review: reviewMatch({
        row,
        teamName: team.name,
        oppName: opp.name,
        style,
        oppStyle: league.styles.get(row.oppId) ?? null,
        oppTablePos: tablePos.get(row.oppId) ?? null,
        tableSize: standings.length,
        shots: shots.filter((s) => s.fixture_id === row.fx.id),
        missingRegulars: missing,
        redCards: { own: reds.filter((r) => r.team_id === teamId).map((r) => name(r.player_id)), opp: reds.filter((r) => r.team_id !== teamId).map((r) => name(r.player_id)) },
      }),
    };
  });

  return {
    team,
    seasonLabel: league.season?.label ?? null,
    style,
    tablePos: tablePos.get(teamId) ?? null,
    standings,
    record: record(season),
    shotProfile: shotProfile(shots, teamId, finished.length),
    xi,
    xiCards: cards as Map<number, PlayerCard>,
    coach,
    upcoming: upcoming.map((row) => ({ row, opp: teamOf(league, row.oppId), oppPos: tablePos.get(row.oppId) ?? null })),
    last: finished
      .slice()
      .reverse()
      .map((row) => ({ row, opp: teamOf(league, row.oppId), oppPos: tablePos.get(row.oppId) ?? null })),
    reviews,
  };
}

export type ClubData = NonNullable<Awaited<ReturnType<typeof getClub>>>;
