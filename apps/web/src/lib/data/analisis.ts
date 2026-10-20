import "server-only";
import { playerPhotoUrls } from "@/lib/assets";
import { num, teamMap, toFormInfo, type FormInfo, type TeamInfo } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";

/** Jendela sparkline harga (hari snapshot UTC, termasuk hari terbaru). */
export const SPARK_DAYS = 14;
export const TREND_LIMIT = 15;
// Batas baris PostgREST (supabase/config.toml max_rows) → ambil per halaman.
const PAGE = 1000;

export type PricePoint = { date: string; priceTenths: number };

export type MarketPlayer = {
  id: number;
  webName: string;
  team: TeamInfo | null;
  position: string | null;
  status: string | null;
  photos: string[];
  priceTenths: number;
  ownedPct: number | null;
  form: FormInfo | null;
  /** Harga per hari snapshot dalam jendela SPARK_DAYS (urut tanggal, bisa bolong). */
  spark: PricePoint[];
};

export type PriceMove = MarketPlayer & { oldTenths: number; deltaTenths: number };
export type TransferTrend = MarketPlayer & { transfersIn: number; transfersOut: number; net: number };

export type AnalisisData = Awaited<ReturnType<typeof getAnalisisData>>;

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = (await page(from, from + PAGE - 1)).data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** "2026-10-20" − n hari (kalender UTC). */
function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Harga & transfer (BLUEPRINT fitur #13 Price watch) dari price_snapshots (satu baris per pemain per
 * hari UTC, diisi worker): perubahan harga antara dua hari snapshot terakhir dan tren transfer GW ini.
 * `pos` menyaring tren transfer per posisi FPL.
 */
export async function getAnalisisData(pos: string | undefined) {
  const supabase = await createClient();

  const [latestRes, playerRows, formRes, teamRes, nextGwRes, liveRes] = await Promise.all([
    supabase.from("price_snapshots").select("captured_on").order("captured_on", { ascending: false }).limit(1).maybeSingle(),
    fetchAll((from, to) =>
      supabase
        .from("v_player_current")
        .select("id, web_name, fpl_code, photo_url_resolved, team_id, fpl_position, status")
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("v_player_form")
      .select("player_id, form_label, form_score, form_reasons, last4_points_per_match, season_points_per_match, last4_xgi90, last4_minutes_share, last4_goals_minus_xg"),
    supabase.from("teams").select("id, name, short_name, fpl_team_code"),
    supabase.from("gameweeks").select("number").eq("is_next", true).maybeSingle(),
    supabase.from("fixtures").select("id", { count: "exact", head: true }).in("status", ["live", "ht"]),
  ]);

  const latestDate = latestRes.data?.captured_on ?? null;
  const base = { latestDate, previousDate: null as string | null, nextGw: nextGwRes.data?.number ?? null, liveCount: liveRes.count ?? 0 };
  const empty = { ...base, risers: [] as PriceMove[], fallers: [] as PriceMove[], transfersIn: [] as TransferTrend[], transfersOut: [] as TransferTrend[] };
  if (!latestDate) return empty;

  const [prevRes, latestRows] = await Promise.all([
    supabase
      .from("price_snapshots")
      .select("captured_on")
      .lt("captured_on", latestDate)
      .order("captured_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchAll((from, to) =>
      supabase
        .from("price_snapshots")
        .select("player_id, price_tenths, selected_by_pct, transfers_in_event, transfers_out_event")
        .eq("captured_on", latestDate)
        .order("player_id")
        .range(from, to),
    ),
  ]);
  const previousDate = prevRes.data?.captured_on ?? null;
  const prevRows = previousDate
    ? await fetchAll((from, to) =>
        supabase.from("price_snapshots").select("player_id, price_tenths").eq("captured_on", previousDate).order("player_id").range(from, to),
      )
    : [];

  // Hanya pemain musim berjalan (v_player_current).
  const teams = teamMap(teamRes.data ?? []);
  const forms = new Map<number, FormInfo>((formRes.data ?? []).map((f) => [f.player_id ?? 0, toFormInfo(f)]));
  const meta = new Map(playerRows.filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const prevPrice = new Map(prevRows.map((r) => [r.player_id, r.price_tenths]));

  const market = latestRows.flatMap((r) => {
    const p = meta.get(r.player_id);
    if (!p) return [];
    const player: MarketPlayer = {
      id: r.player_id,
      webName: p.web_name ?? "?",
      team: p.team_id != null ? (teams.get(p.team_id) ?? null) : null,
      position: p.fpl_position,
      status: p.status,
      photos: playerPhotoUrls(p.fpl_code, p.photo_url_resolved),
      priceTenths: r.price_tenths,
      ownedPct: num(r.selected_by_pct),
      form: forms.get(r.player_id) ?? null,
      spark: [],
    };
    return [{ player, row: r }];
  });

  const owned = (p: MarketPlayer) => p.ownedPct ?? 0;
  const moves: PriceMove[] = market.flatMap(({ player }) => {
    const old = prevPrice.get(player.id);
    if (old == null || old === player.priceTenths) return [];
    return [{ ...player, oldTenths: old, deltaTenths: player.priceTenths - old }];
  });
  const risers = moves.filter((m) => m.deltaTenths > 0).sort((a, b) => b.deltaTenths - a.deltaTenths || owned(b) - owned(a));
  const fallers = moves.filter((m) => m.deltaTenths < 0).sort((a, b) => a.deltaTenths - b.deltaTenths || owned(b) - owned(a));

  const trends: TransferTrend[] = market.flatMap(({ player, row }) => {
    if (row.transfers_in_event == null && row.transfers_out_event == null) return [];
    if (pos && player.position !== pos) return [];
    const tin = row.transfers_in_event ?? 0;
    const tout = row.transfers_out_event ?? 0;
    return [{ ...player, transfersIn: tin, transfersOut: tout, net: tin - tout }];
  });
  const transfersIn = trends.filter((t) => t.net > 0).sort((a, b) => b.net - a.net).slice(0, TREND_LIMIT);
  const transfersOut = trends.filter((t) => t.net < 0).sort((a, b) => a.net - b.net).slice(0, TREND_LIMIT);

  // Sparkline hanya untuk pemain yang ditampilkan.
  const listed = [...risers, ...fallers, ...transfersIn, ...transfersOut];
  const ids = [...new Set(listed.map((p) => p.id))];
  const sparkRows = ids.length
    ? await fetchAll((from, to) =>
        supabase
          .from("price_snapshots")
          .select("player_id, captured_on, price_tenths")
          .in("player_id", ids)
          .gte("captured_on", shiftDay(latestDate, -(SPARK_DAYS - 1)))
          .lte("captured_on", latestDate)
          .order("player_id")
          .order("captured_on")
          .range(from, to),
      )
    : [];
  const sparks = new Map<number, PricePoint[]>();
  for (const r of sparkRows) {
    const list = sparks.get(r.player_id) ?? [];
    list.push({ date: r.captured_on, priceTenths: r.price_tenths });
    sparks.set(r.player_id, list);
  }
  for (const p of listed) p.spark = sparks.get(p.id) ?? [];

  return { ...base, previousDate, risers, fallers, transfersIn, transfersOut };
}
