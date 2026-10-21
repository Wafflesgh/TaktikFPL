import "server-only";
import { cookies } from "next/headers";
import { playerPhotoUrls } from "@/lib/assets";
import { getEntry, getHistory, getPicks } from "@/lib/fpl";
import { estimateFreeTransfers, holdNotes, horizonOf, MAX_FREE_TRANSFERS, planTransfers, type ProjPlayer, type Reason } from "@/lib/reco";
import { createClient } from "@/lib/supabase/server";

export const ENTRY_COOKIE = "tfpl_entry";

export type SquadRow = ProjPlayer & {
  slot: number;
  isStarter: boolean;
  isCaptain: boolean;
  isVice: boolean;
  photos: string[];
  elementId: number | null;
};

/** Proyeksi run terbaru untuk semua pemain musim ini (dipaginasi: PostgREST maks 1000 baris). */
async function loadProjections() {
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("model_runs")
    .select("id, notes, model_version, finished_at")
    .eq("status", "ok")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return null;
  const notes = (run.notes ?? {}) as { first_gw?: number; horizon_gw?: number };
  const firstGw = Number(notes.first_gw ?? 0);

  const rows: { player_id: number; xpts: number; component_breakdown: unknown }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("projections")
      .select("player_id, xpts, component_breakdown")
      .eq("model_run_id", run.id)
      .range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const byPlayer = new Map<number, Record<number, number>>();
  const reasons = new Map<number, Reason[]>();
  for (const r of rows) {
    const bd = r.component_breakdown as { gw?: number; reasons?: Reason[] } | null;
    if (bd?.reasons) reasons.set(r.player_id, bd.reasons);
    const gw = Number(bd?.gw ?? firstGw);
    const m = byPlayer.get(r.player_id) ?? {};
    m[gw] = (m[gw] ?? 0) + Number(r.xpts);
    byPlayer.set(r.player_id, m);
  }
  return { runId: run.id, firstGw, horizonGw: Number(notes.horizon_gw ?? 6), modelVersion: run.model_version, finishedAt: run.finished_at, byPlayer, reasons };
}

async function loadPool(byPlayer: Map<number, Record<number, number>>, firstGw: number, reasons: Map<number, Reason[]>) {
  const supabase = await createClient();
  const [{ data: players }, { data: teams }] = await Promise.all([
    supabase.from("v_player_current").select("id, web_name, fpl_code, photo_url_resolved, team_id, fpl_position, status, price_tenths, fpl_element_id").limit(1000),
    supabase.from("teams").select("id, short_name"),
  ]);
  const teamShort = new Map((teams ?? []).map((t) => [t.id, t.short_name ?? "?"]));
  return (players ?? []).map((p) => {
    const byGw = byPlayer.get(p.id ?? 0) ?? {};
    return {
      id: p.id ?? 0,
      name: p.web_name ?? "?",
      position: p.fpl_position ?? "?",
      teamId: p.team_id ?? 0,
      teamShort: teamShort.get(p.team_id ?? 0) ?? "?",
      priceTenths: p.price_tenths ?? 0,
      status: p.status,
      byGw,
      horizon: horizonOf(byGw, firstGw),
      next: byGw[firstGw] ?? 0,
      reasons: reasons.get(p.id ?? 0) ?? [],
      elementId: p.fpl_element_id,
      photos: playerPhotoUrls(p.fpl_code, p.photo_url_resolved),
    };
  });
}

/** Squad optimal dari nol (hasil ILP worker, laporan 'weekly_draft' terbaru). */
async function loadOptimalSquad() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("analysis_reports")
    .select("title, content_json, created_at")
    .eq("report_type", "weekly_draft")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = (data?.content_json ?? null) as { kind?: string; squad?: number[]; starters?: number[]; captain?: number; cost_tenths?: number } | null;
  if (!data || c?.kind !== "optimal_squad") return null;
  return { title: data.title ?? "Squad optimal", squad: c.squad ?? [], starters: c.starters ?? [], captain: c.captain ?? 0, costTenths: c.cost_tenths ?? 0 };
}

export async function getEntryId(): Promise<number | null> {
  const raw = (await cookies()).get(ENTRY_COOKIE)?.value;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** ftOverride: jumlah free transfer yang diisi pengguna (menimpa estimasi dari riwayat). */
export async function getTimData(entryId: number | null, ftOverride: number | null = null) {
  const proj = await loadProjections();
  if (!proj) return { status: "no_projections" as const };
  const pool = await loadPool(proj.byPlayer, proj.firstGw, proj.reasons);
  const byId = new Map(pool.map((p) => [p.id, p]));
  const optimal = await loadOptimalSquad();
  const optimalPlayers = optimal ? optimal.squad.map((id) => byId.get(id)).filter((p): p is (typeof pool)[number] => Boolean(p)) : [];

  // Alternatif per posisi (di luar squad optimal): 3 nilai horizon tertinggi + 2 opsi hemat (nilai/£ terbaik).
  const inOptimal = new Set(optimal?.squad ?? []);
  const alternatives = Object.fromEntries(
    ["GKP", "DEF", "MID", "FWD"].map((pos) => {
      const rest = pool.filter((p) => p.position === pos && !inOptimal.has(p.id) && p.horizon > 0);
      const top = [...rest].sort((a, b) => b.horizon - a.horizon).slice(0, 3);
      const topIds = new Set(top.map((p) => p.id));
      const value = rest
        .filter((p) => !topIds.has(p.id))
        .sort((a, b) => b.horizon / b.priceTenths - a.horizon / a.priceTenths)
        .slice(0, 2);
      return [pos, { top, value }];
    }),
  ) as Record<string, { top: typeof pool; value: typeof pool }>;

  const base = { firstGw: proj.firstGw, horizonGw: proj.horizonGw, modelVersion: proj.modelVersion, finishedAt: proj.finishedAt, optimal, optimalPlayers, alternatives };
  if (!entryId) return { status: "no_entry" as const, ...base };

  const entry = await getEntry(entryId);
  if (!entry) return { status: "entry_not_found" as const, entryId, ...base };
  const gw = entry.current_event;
  const [picks, history] = await Promise.all([gw ? getPicks(entryId, gw) : null, getHistory(entryId)]);
  if (!picks) return { status: "no_picks" as const, entry, ...base };

  const byElement = new Map(pool.filter((p) => p.elementId != null).map((p) => [p.elementId as number, p]));
  const squad: SquadRow[] = picks.picks
    .map((pk) => {
      const p = byElement.get(pk.element);
      return p
        ? { ...p, slot: pk.position, isStarter: pk.position <= 11, isCaptain: pk.is_captain, isVice: pk.is_vice_captain }
        : null;
    })
    .filter((r): r is SquadRow => r !== null)
    .sort((a, b) => a.slot - b.slot);

  const bank = picks.entry_history.bank;
  const ftEstimate = estimateFreeTransfers(entry.started_event, proj.firstGw, history?.current ?? [], history?.chips ?? []);
  // Tim baru yang belum melewati deadline pertama: perubahan bebas → anggap transfer gratis tak terbatas.
  const freeTransfers = ftOverride ?? ftEstimate ?? 15;
  const plans = planTransfers(squad, pool, bank, freeTransfers, Math.min(15, Math.max(3, freeTransfers + 1)));
  const bestPlan = plans.reduce((a, b) => (b.net > a.net + 0.5 ? b : a), plans[0]);
  const notes = holdNotes(squad, proj.firstGw);
  const starters = squad.filter((p) => p.isStarter).sort((a, b) => b.next - a.next);

  return {
    status: "ok" as const,
    ...base,
    entry,
    picksGw: gw,
    bankTenths: bank,
    squad,
    plans,
    bestPlan,
    freeTransfers,
    ftEstimate,
    ftOverridden: ftOverride != null,
    maxFreeTransfers: MAX_FREE_TRANSFERS,
    notes,
    captain: starters[0] ?? null,
    vice: starters[1] ?? null,
    squadHorizon: squad.filter((p) => p.isStarter).reduce((s, p) => s + p.horizon, 0),
  };
}

export type TimData = Awaited<ReturnType<typeof getTimData>>;
