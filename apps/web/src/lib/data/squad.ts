import "server-only";
import { playerPhotoUrls } from "@/lib/assets";
import { num } from "@/lib/data/dashboard";
import { fetchAll, type League } from "@/lib/data/league";
import type { LineupRow } from "@/lib/analysis/xi";
import { createClient } from "@/lib/supabase/server";

/** Ringkasan pemain untuk XI, duel zona, dan review laga. */
export type PlayerCard = {
  id: number;
  webName: string;
  photos: string[];
  position: string | null;
  status: string | null;
  priceTenths: number | null;
  formLabel: string | null;
  formScore: number | null;
  last4Ppm: number | null;
  last4Xgi90: number | null;
  xgi90: number | null;
  defcon90: number | null;
  points: number | null;
};

export async function getPlayerCards(ids: number[]): Promise<Map<number, PlayerCard>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const supabase = await createClient();
  const [baseRes, curRes, formRes] = await Promise.all([
    supabase.from("players").select("id, web_name, fpl_code, photo_url_resolved").in("id", uniq),
    supabase.from("v_player_current").select("id, fpl_position, status, price_tenths").in("id", uniq),
    supabase.from("v_player_form").select("player_id, as_of, form_label, form_score, last4_points_per_match, last4_xgi90, season_xgi90").in("player_id", uniq),
  ]);
  const cur = new Map((curRes.data ?? []).map((c) => [c.id, c]));
  const forms = new Map((formRes.data ?? []).map((f) => [f.player_id, f]));
  const asOfs = [...new Set((formRes.data ?? []).map((f) => f.as_of).filter((a): a is string => a != null))];
  const seasonRes = asOfs.length
    ? await supabase.from("player_form_features").select("player_id, as_of, metrics").eq("window_label", "season").in("player_id", uniq).in("as_of", asOfs)
    : { data: [] as { player_id: number; as_of: string; metrics: unknown }[] };
  const season = new Map<number, Record<string, unknown>>();
  for (const r of seasonRes.data ?? []) if (forms.get(r.player_id)?.as_of === r.as_of) season.set(r.player_id, r.metrics as Record<string, unknown>);
  return new Map(
    (baseRes.data ?? []).map((p) => {
      const c = cur.get(p.id);
      const f = forms.get(p.id);
      const m = season.get(p.id);
      return [
        p.id,
        {
          id: p.id,
          webName: p.web_name,
          photos: playerPhotoUrls(p.fpl_code, p.photo_url_resolved),
          position: c?.fpl_position ?? null,
          status: c?.status ?? null,
          priceTenths: c?.price_tenths ?? null,
          formLabel: f?.form_label ?? null,
          formScore: num(f?.form_score),
          last4Ppm: num(f?.last4_points_per_match),
          last4Xgi90: num(f?.last4_xgi90),
          xgi90: num(f?.season_xgi90),
          defcon90: typeof m?.defcon90 === "number" ? m.defcon90 : null,
          points: typeof m?.points === "number" ? m.points : null,
        },
      ];
    }),
  );
}

/** Fixture selesai terakhir per tim (terbaru dulu) yang punya data Understat. */
export function recentFixtureIds(league: League, teamId: number, n: number): number[] {
  return league.fixtures
    .filter((f) => f.status === "finished" && (f.homeId === teamId || f.awayId === teamId) && league.stats.has(`${f.id}:${teamId}`))
    .slice(-n)
    .reverse()
    .map((f) => f.id);
}

/** Lineup Understat beberapa tim di laga-laga terakhirnya: tim → { baris, urutan fixture terbaru dulu }. */
export async function getRecentLineups(
  league: League,
  teamIds: number[],
  n: number,
): Promise<Map<number, { rows: LineupRow[]; order: number[] }>> {
  const supabase = await createClient();
  const order = new Map(teamIds.map((t) => [t, recentFixtureIds(league, t, n)]));
  const fxIds = [...new Set([...order.values()].flat())];
  if (fxIds.length === 0) return new Map();
  const rows = await fetchAll((a, b) =>
    supabase
      .from("lineups")
      .select("fixture_id, team_id, player_id, is_starter, position_label")
      .in("team_id", teamIds)
      .in("fixture_id", fxIds)
      .order("fixture_id")
      .order("player_id")
      .range(a, b),
  );
  return new Map(teamIds.map((t) => [t, { rows: rows.filter((r) => r.team_id === t), order: order.get(t) ?? [] }]));
}
