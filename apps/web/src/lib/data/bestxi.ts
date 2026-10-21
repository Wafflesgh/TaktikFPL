import "server-only";
import { playerPhotoUrls } from "@/lib/assets";
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
};

export type BestXi = {
  gw: number;
  formation: string;
  xpts: number;
  captain: number;
  vice: number;
  players: XiPlayer[];
  finishedAt: string | null;
};

const POS_ORDER = ["GKP", "DEF", "MID", "FWD"];

type BestXiJson = { gw: number; starters: number[]; captain: number; vice: number; formation: string; xpts: number };

/** XI terbaik GW berikutnya (ILP worker, tanpa budget, maks 3 per klub) + alasan per pemain. */
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

  const [{ data: proj }, { data: players }, { data: teams }] = await Promise.all([
    supabase
      .from("projections")
      .select("player_id, fixture_id, xpts, component_breakdown")
      .eq("model_run_id", report.model_run_id)
      .in("player_id", xi.starters),
    supabase
      .from("v_player_current")
      .select("id, web_name, fpl_code, photo_url_resolved, team_id, team_short_name, fpl_position, status, price_tenths")
      .in("id", xi.starters),
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
    };
  });
  list.sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || b.xpts - a.xpts);
  return { gw: xi.gw, formation: xi.formation, xpts: xi.xpts, captain: xi.captain, vice: xi.vice, players: list, finishedAt: report.created_at };
}
