// Rekomendasi dari angka engine (xPts v0 di worker). Fungsi murni: hanya membandingkan & mengurutkan
// nilai proyeksi, tidak membuat angka baru (CLAUDE.md aturan 1).

/** Alasan dari worker (app/models/reasons.py). */
export type Reason = { kind: string; tone: "good" | "warn" | "bad"; text: string };

export type ProjPlayer = {
  id: number;
  name: string;
  position: string;
  teamId: number;
  teamShort: string;
  priceTenths: number;
  status: string | null;
  /** xPts per GW (GW → total, termasuk DGW). */
  byGw: Record<number, number>;
  /** Total xPts horizon terdiskon (0.85 per GW). */
  horizon: number;
  next: number;
  reasons: Reason[];
};

export type TransferIdea = {
  out: ProjPlayer;
  in: ProjPlayer;
  gainHorizon: number;
  gainNext: number;
  budgetLeftTenths: number;
  /** Penjelasan pilihan pengganti: berapa kandidat yang lolos syarat (posisi, budget, klub) & runner-up-nya. */
  options: number;
  maxPriceTenths: number;
  runnerUp: ProjPlayer | null;
  /** Penjelasan pemain yang dijual: swap terbaik berikutnya bila pemain lain yang dijual (diisi planTransfers). */
  nextSwap?: { out: ProjPlayer; in: ProjPlayer; gainHorizon: number } | null;
};

export type HoldNote = { player: ProjPlayer; kind: "tahan" | "jual"; reason: string };

export const DISCOUNT = 0.85;

export function horizonOf(byGw: Record<number, number>, firstGw: number): number {
  return Object.entries(byGw).reduce((s, [gw, x]) => s + x * DISCOUNT ** (Number(gw) - firstGw), 0);
}

/** Transfer tunggal terbaik per pemain keluar: posisi sama, budget cukup, maks 3 per klub. */
export function bestTransfers(
  squad: ProjPlayer[],
  pool: ProjPlayer[],
  bankTenths: number,
  maxPerTeam = 3,
  limit = 5,
): TransferIdea[] {
  const inSquad = new Set(squad.map((p) => p.id));
  const teamCount = new Map<number, number>();
  for (const p of squad) teamCount.set(p.teamId, (teamCount.get(p.teamId) ?? 0) + 1);

  const ideas: TransferIdea[] = [];
  for (const out of squad) {
    const budget = out.priceTenths + bankTenths;
    let best: ProjPlayer | null = null;
    let runnerUp: ProjPlayer | null = null;
    let options = 0;
    for (const c of pool) {
      if (inSquad.has(c.id) || c.position !== out.position || c.priceTenths > budget) continue;
      const clubAfter = (teamCount.get(c.teamId) ?? 0) - (c.teamId === out.teamId ? 1 : 0) + 1;
      if (clubAfter > maxPerTeam) continue;
      options++;
      if (!best || c.horizon > best.horizon) {
        runnerUp = best;
        best = c;
      } else if (!runnerUp || c.horizon > runnerUp.horizon) runnerUp = c;
    }
    if (best && best.horizon - out.horizon > 0.3) {
      ideas.push({
        out,
        in: best,
        gainHorizon: best.horizon - out.horizon,
        gainNext: best.next - out.next,
        budgetLeftTenths: budget - best.priceTenths,
        options,
        maxPriceTenths: budget,
        runnerUp,
      });
    }
  }
  // Satu pemain masuk hanya sekali (ambil gain terbesar).
  const seen = new Set<number>();
  return ideas
    .sort((a, b) => b.gainHorizon - a.gainHorizon)
    .filter((i) => (seen.has(i.in.id) ? false : (seen.add(i.in.id), true)))
    .slice(0, limit);
}

/**
 * Catatan per pemain squad:
 * - "tahan": GW depan buruk (≤ 75% rata-rata GW sesudahnya) tetapi rangkaian berikutnya bagus.
 * - "jual": tidak tersedia (cedera/skors) dan proyeksi horizon sangat rendah.
 */
export function holdNotes(squad: ProjPlayer[], firstGw: number): HoldNote[] {
  const notes: HoldNote[] = [];
  for (const p of squad) {
    const later = Object.entries(p.byGw)
      .filter(([gw]) => Number(gw) > firstGw)
      .map(([, x]) => x);
    const avgLater = later.length ? later.reduce((a, b) => a + b, 0) / later.length : 0;
    if (["i", "s", "u", "n"].includes(p.status ?? "") && p.horizon < 2) {
      notes.push({ player: p, kind: "jual", reason: "unavailable & very low 6-GW projection" });
    } else if (avgLater > 2 && p.next <= 0.75 * avgLater) {
      notes.push({
        player: p,
        kind: "tahan",
        reason: `GW${firstGw} is tough (${p.next.toFixed(1)} xPts), but averages ${avgLater.toFixed(1)} xPts in the following GWs`,
      });
    }
  }
  return notes;
}

// Aturan transfer FPL (musim 2024/25+). API publik tidak menyediakan jumlah free transfer,
// jadi ini hanya untuk ESTIMASI — pengguna bisa mengoreksi angkanya di UI.
export const MAX_FREE_TRANSFERS = 5;
export const HIT_COST = 4;
const KEEP_FT_CHIPS = new Set(["wildcard", "freehit"]);

/**
 * Estimasi free transfer untuk GW `nextGw` dari riwayat entry: +1 per GW (maks 5), dikurangi transfer
 * yang dipakai; GW dengan Wildcard/Free Hit tidak mengubah jumlahnya. null = tim baru yang belum
 * melewati deadline pertamanya (squad bisa diubah bebas tanpa biaya).
 */
export function estimateFreeTransfers(
  startedEvent: number | null,
  nextGw: number,
  history: { event: number; event_transfers: number }[],
  chips: { name: string; event: number }[],
): number | null {
  if (startedEvent == null || startedEvent >= nextGw) return null;
  const used = new Map(history.map((h) => [h.event, h.event_transfers]));
  const chipGw = new Set(chips.filter((c) => KEEP_FT_CHIPS.has(c.name)).map((c) => c.event));
  let ft = 1;
  for (let gw = startedEvent + 1; gw < nextGw; gw++) {
    if (chipGw.has(gw)) continue;
    ft = Math.min(MAX_FREE_TRANSFERS, Math.max(0, ft - (used.get(gw) ?? 0)) + 1);
  }
  return ft;
}

export type TransferPlan = {
  transfers: TransferIdea[];
  hits: number;
  gainHorizon: number;
  gainNext: number;
  /** gain horizon − biaya hit. */
  net: number;
};

/**
 * Rencana 0..maxTransfers transfer (greedy: transfer terbaik satu per satu, squad & bank diperbarui).
 * Transfer ke-(FT+1) dst. kena hit −4; rencana terbaik = net tertinggi.
 */
export function planTransfers(
  squad: ProjPlayer[],
  pool: ProjPlayer[],
  bankTenths: number,
  freeTransfers: number,
  maxTransfers = Math.max(3, freeTransfers + 1),
): TransferPlan[] {
  const plans: TransferPlan[] = [{ transfers: [], hits: 0, gainHorizon: 0, gainNext: 0, net: 0 }];
  let current = [...squad];
  let bank = bankTenths;
  const sold = new Set<number>();
  const done: TransferIdea[] = [];
  for (let k = 1; k <= maxTransfers; k++) {
    const bought = new Set(done.map((t) => t.in.id));
    const ideas = bestTransfers(
      current.filter((p) => !bought.has(p.id)),
      pool.filter((p) => !sold.has(p.id)),
      bank,
    ).filter((t) => !current.some((p) => p.id === t.in.id));
    const found = ideas[0];
    if (!found) break;
    const alt = ideas.find((t) => t.out.id !== found.out.id);
    const next: TransferIdea = { ...found, nextSwap: alt ? { out: alt.out, in: alt.in, gainHorizon: alt.gainHorizon } : null };
    // bestTransfers hanya melihat squad tanpa pemain yang baru dibeli → cek ulang batas klub & budget.
    const clubAfter = current.filter((p) => p.teamId === next.in.teamId && p.id !== next.out.id).length + 1;
    if (clubAfter > 3) break;
    done.push(next);
    sold.add(next.out.id);
    current = current.map((p) => (p.id === next.out.id ? next.in : p));
    bank = bank + next.out.priceTenths - next.in.priceTenths;
    const hits = Math.max(0, k - freeTransfers);
    const gainHorizon = done.reduce((s, t) => s + t.gainHorizon, 0);
    plans.push({
      transfers: [...done],
      hits,
      gainHorizon,
      gainNext: done.reduce((s, t) => s + t.gainNext, 0),
      net: gainHorizon - hits * HIT_COST,
    });
  }
  return plans;
}
