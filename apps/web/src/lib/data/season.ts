import "server-only";
import { getEntry, getHistory, getPicks } from "@/lib/fpl";
import { userSeasonPlan, type ChipRec, type SeasonPlanJson } from "@/lib/season";
import { createClient } from "@/lib/supabase/server";

export type PlanSnapshot = { gw: number; createdAt: string; chips: Pick<ChipRec, "name" | "label" | "start_event" | "recommended_gw">[] };

/** Rencana musim terbaru + snapshot mingguan (satu per GW, permanen) + versi untuk squad pengguna. */
export async function getSeasonPlan(entryId: number | null) {
  const supabase = await createClient();
  const [{ data: latest }, { data: history }, { data: gws }] = await Promise.all([
    supabase
      .from("analysis_reports")
      .select("gameweek_id, content_json, created_at")
      .eq("report_type", "season_plan")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("analysis_reports")
      .select("gameweek_id, created_at, chips:content_json->chips")
      .eq("report_type", "season_plan")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("gameweeks").select("id, number"),
  ]);
  const plan = (latest?.content_json ?? null) as SeasonPlanJson | null;
  if (!latest || plan?.kind !== "season_plan") return null;
  const gwNum = new Map((gws ?? []).map((g) => [g.id, g.number]));

  const snapshots: PlanSnapshot[] = (history ?? []).map((h) => ({
    gw: gwNum.get(h.gameweek_id) ?? 0,
    createdAt: h.created_at,
    chips: ((h.chips ?? []) as ChipRec[]).map((c) => ({ name: c.name, label: c.label, start_event: c.start_event, recommended_gw: c.recommended_gw })),
  }));

  // Nama & posisi untuk squad acuan dan squad pengguna.
  const { data: players } = await supabase.from("v_player_current").select("id, web_name, fpl_position, fpl_element_id, team_short_name").limit(1000);
  const position = new Map((players ?? []).map((p) => [p.id ?? 0, p.fpl_position ?? "MID"]));
  const name = new Map((players ?? []).map((p) => [p.id ?? 0, p.web_name ?? "?"]));
  const team = new Map((players ?? []).map((p) => [p.id ?? 0, p.team_short_name ?? "?"]));
  const base = { plan, snapshots, createdAt: latest.created_at, name: Object.fromEntries(name), team: Object.fromEntries(team), position: Object.fromEntries(position) };
  if (!entryId) return { ...base, user: null };

  const entry = await getEntry(entryId);
  const gw = entry?.current_event;
  const [picks, hist] = await Promise.all([gw ? getPicks(entryId, gw) : null, getHistory(entryId)]);
  if (!entry || !picks) return { ...base, user: null };
  const byElement = new Map((players ?? []).filter((p) => p.fpl_element_id != null).map((p) => [p.fpl_element_id as number, p.id ?? 0]));
  const squad = picks.picks.map((p) => byElement.get(p.element)).filter((id): id is number => Boolean(id));
  const chipsUsed = hist?.chips ?? [];
  return { ...base, user: { entryName: entry.name, squadGw: gw, squad, chipsUsed, ...userSeasonPlan(plan, squad, position, name, chipsUsed) } };
}

export type SeasonPlanData = NonNullable<Awaited<ReturnType<typeof getSeasonPlan>>>;
