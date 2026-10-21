import "server-only";
import { createClient } from "@/lib/supabase/server";

export const MODEL = "xpts-v1-backtest";
export const BASELINE = "baseline-last4";

export type GwAccuracy = {
  gw: number;
  model: Record<string, number>;
  baseline: Record<string, number>;
};

/** Hasil job evaluate_model (public.model_evaluations) per GW: model vs baseline. */
export async function getAccuracy(): Promise<GwAccuracy[]> {
  const supabase = await createClient();
  const { data: season } = await supabase.from("seasons").select("id").eq("is_current", true).maybeSingle();
  if (!season) return [];
  const [{ data: evals }, { data: gws }] = await Promise.all([
    supabase.from("model_evaluations").select("gameweek_id, model_version, metric, value").in("model_version", [MODEL, BASELINE]),
    supabase.from("gameweeks").select("id, number").eq("season_id", season.id),
  ]);
  const gwNumber = new Map((gws ?? []).map((g) => [g.id, g.number]));
  const byGw = new Map<number, GwAccuracy>();
  for (const e of evals ?? []) {
    const gw = gwNumber.get(e.gameweek_id);
    if (gw == null) continue;
    const row = byGw.get(gw) ?? { gw, model: {}, baseline: {} };
    (e.model_version === MODEL ? row.model : row.baseline)[e.metric] = Number(e.value);
    byGw.set(gw, row);
  }
  return [...byGw.values()].sort((a, b) => a.gw - b.gw);
}
