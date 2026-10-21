import "server-only";
import { playerPhotoUrls } from "@/lib/assets";
import type { XptsBreakdown } from "@/components/XptsDetail";
import type { Reason } from "@/lib/reco";
import { createClient } from "@/lib/supabase/server";

export type XiPlayer = {
  id: number;
  name: string;
  position: string;
  teamShort: string;
  priceTenths: number;
  status: string | null;
  photos: string[];
  xpts: number;
  /** Lawan GW itu, mis. "ARS (H)"; >1 untuk double gameweek. */
  opponents: string[];
  reasons: Reason[];
  /** component_breakdown per laga GW itu (rincian xPts & probabilitas). */
  breakdown: XptsBreakdown[];
};

export type BestXi = {
  gw: number;
  formation: string;
  xpts: number;
  captain: number;
  vice: number;
  players: XiPlayer[];
  /** Cadangan sesuai urutan FPL (kiper dulu); kosong untuk laporan lama tanpa budget. */
  bench: XiPlayer[];
  costTenths: number | null;
  finishedAt: string | null;
};

const POS_ORDER = ["GKP", "DEF", "MID", "FWD"];

type BestXiJson = { gw: number; starters: number[]; bench?: number[]; cost_tenths?: number; captain: number; vice: number; formation: string; xpts: number };

/** Squad terbaik GW berikutnya (ILP worker, budget £100m, maks 3 per klub): XI + cadangan + alasan. */
export async function getBestXi(): Promise<BestXi | null> {
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("analysis_reports")
    .select("model_run_id, content_json, created_at")
    .eq("report_type", "weekly_draft")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const xi = (report?.content_json as { best_xi?: BestXiJson } | null)?.best_xi;
  if (!report?.model_run_id || !xi?.starters?.length) return null;
  const ids = [...xi.starters, ...(xi.bench ?? [])];

  const [{ data: proj }, { data: players }, { data: teams }] = await Promise.all([
    supabase
      .from("projections")
      .select("player_id, fixture_id, xpts, component_breakdown")
      .eq("model_run_id", report.model_run_id)
      .in("player_id", ids),
    supabase
      .from("v_player_current")
      .select("id, web_name, fpl_code, photo_url_resolved, team_id, team_short_name, fpl_position, status, price_tenths")
      .in("id", ids),
    supabase.from("teams").select("id, short_name"),
  ]);
  const gwRows = (proj ?? []).filter((r) => (r.component_breakdown as { gw?: number } | null)?.gw === xi.gw);
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, home_team_id, away_team_id")
    .in("id", [...new Set(gwRows.map((r) => r.fixture_id))]);
  const fx = new Map((fixtures ?? []).map((f) => [f.id, f]));
  const short = new Map((teams ?? []).map((t) => [t.id, t.short_name ?? "?"]));

  const list: XiPlayer[] = (players ?? []).map((p) => {
    const mine = gwRows.filter((r) => r.player_id === p.id);
    const reasons = mine
      .map((r) => (r.component_breakdown as { reasons?: Reason[] } | null)?.reasons)
      .find((r): r is Reason[] => Array.isArray(r));
    return {
      id: p.id ?? 0,
      name: p.web_name ?? "?",
      position: p.fpl_position ?? "?",
      teamShort: p.team_short_name ?? "?",
      priceTenths: p.price_tenths ?? 0,
      status: p.status,
      photos: playerPhotoUrls(p.fpl_code, p.photo_url_resolved),
      xpts: mine.reduce((s, r) => s + Number(r.xpts), 0),
      opponents: mine.map((r) => {
        const f = fx.get(r.fixture_id);
        const home = (r.component_breakdown as { home?: boolean } | null)?.home ?? f?.home_team_id === p.team_id;
        const opp = f ? (home ? f.away_team_id : f.home_team_id) : 0;
        return `${short.get(opp) ?? "?"} (${home ? "H" : "A"})`;
      }),
      reasons: reasons ?? [],
      breakdown: mine.map((r) => (r.component_breakdown ?? {}) as XptsBreakdown),
    };
  });
  const byId = new Map(list.map((p) => [p.id, p]));
  const starters = list.filter((p) => xi.starters.includes(p.id));
  starters.sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || b.xpts - a.xpts);
  const bench = (xi.bench ?? []).map((id) => byId.get(id)).filter((p): p is XiPlayer => Boolean(p));
  return {
    gw: xi.gw,
    formation: xi.formation,
    xpts: xi.xpts,
    captain: xi.captain,
    vice: xi.vice,
    players: starters,
    bench,
    costTenths: xi.cost_tenths ?? null,
    finishedAt: report.created_at,
  };
}
