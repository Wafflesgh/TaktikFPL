import "server-only";
import { fixtureOutlook, type Duelist, type Outlook, type StyleSplit } from "@/lib/analysis/outlook";
import { usualXi } from "@/lib/analysis/xi";
import type { TeamInfo } from "@/lib/data/dashboard";
import { getLeague, teamOf, teamRows, type TeamRow } from "@/lib/data/league";
import { getPlayerCards, getRecentLineups } from "@/lib/data/squad";
import type { PlayerTacticsJson } from "@/lib/data/tactics";
import { facingSlots } from "@/lib/positions";
import { createClient } from "@/lib/supabase/server";

export type FixtureOutlookRow = { row: TeamRow; opp: TeamInfo; xpts: number | null; outlook: Outlook };

const UPCOMING = 6;
const LINEUP_WINDOW = 6;

/** Laga mendatang tim pemain + analisis kesulitan per lawan (fundamental & teknis). */
export async function getPlayerOutlook(args: {
  playerId: number;
  playerName: string;
  teamId: number;
  position: string | null;
  form: { label: string | null; score: number | null; last4Ppm: number | null } | null;
  tactics: PlayerTacticsJson | null;
}): Promise<FixtureOutlookRow[]> {
  const league = await getLeague();
  const upcoming = teamRows(league, args.teamId)
    .filter((r) => r.fx.seasonId === league.season?.id && r.fx.status !== "finished" && r.fx.status !== "cancelled")
    .slice(0, UPCOMING);
  if (upcoming.length === 0) return [];
  const oppIds = [...new Set(upcoming.map((r) => r.oppId))];
  const supabase = await createClient();
  const [lineups, projRes] = await Promise.all([
    getRecentLineups(league, oppIds, LINEUP_WINDOW),
    supabase.from("v_latest_projections").select("fixture_id, xpts").eq("player_id", args.playerId).in("fixture_id", upcoming.map((r) => r.fx.id)),
  ]);
  const xpts = new Map((projRes.data ?? []).map((p) => [p.fixture_id, p.xpts]));

  const role = args.tactics?.primary_role ?? null;
  const facing = role ? facingSlots(role) : [];
  const xis = new Map(oppIds.map((t) => [t, lineups.get(t) ? usualXi(lineups.get(t)!.rows, lineups.get(t)!.order) : null]));
  const duelIds = [...xis.values()].flatMap((xi) => (xi ? xi.players.filter((p) => facing.includes(p.slot)).map((p) => p.playerId) : []));
  const cards = await getPlayerCards(duelIds);

  const split = (args.tactics?.split ?? null) as Record<string, StyleSplit> | null;
  return upcoming.map((row) => {
    const xi = xis.get(row.oppId);
    const duel: Duelist[] = xi
      ? xi.players
          .filter((p) => facing.includes(p.slot))
          .sort((a, b) => facing.indexOf(a.slot) - facing.indexOf(b.slot) || b.startsInSlot - a.startsInSlot)
          .map((p) => {
            const c = cards.get(p.playerId);
            return {
              id: p.playerId,
              name: c?.webName ?? String(p.playerId),
              slot: p.slot,
              startsInSlot: p.startsInSlot,
              sample: xi.sample,
              formLabel: c?.formLabel ?? null,
              formScore: c?.formScore ?? null,
              last4Ppm: c?.last4Ppm ?? null,
              xgi90: c?.xgi90 ?? null,
              defcon90: c?.defcon90 ?? null,
            };
          })
      : [];
    const oppLast5 = teamRows(league, row.oppId)
      .filter((r) => r.result != null && r.fx.seasonId === league.season?.id)
      .slice(-5)
      .map((r) => r.result!);
    const opp = teamOf(league, row.oppId);
    return {
      row,
      opp,
      xpts: num(xpts.get(row.fx.id)),
      outlook: fixtureOutlook({
        playerName: args.playerName,
        position: args.position,
        role,
        form: args.form,
        xgi90: args.tactics?.xgi90 ?? null,
        split,
        row,
        oppName: opp.name,
        oppStyle: league.styles.get(row.oppId) ?? null,
        oppLast5,
        duel,
        xpts: num(xpts.get(row.fx.id)),
      }),
    };
  });
}

const num = (v: unknown) => (v == null ? null : Number(v));
