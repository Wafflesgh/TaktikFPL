// Rekomendasi dari angka engine (xPts v0 di worker). Fungsi murni: hanya membandingkan & mengurutkan
// nilai proyeksi, tidak membuat angka baru (CLAUDE.md aturan 1).

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
};

export type TransferIdea = {
  out: ProjPlayer;
  in: ProjPlayer;
  gainHorizon: number;
  gainNext: number;
  budgetLeftTenths: number;
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
    for (const c of pool) {
      if (inSquad.has(c.id) || c.position !== out.position || c.priceTenths > budget) continue;
      const clubAfter = (teamCount.get(c.teamId) ?? 0) - (c.teamId === out.teamId ? 1 : 0) + 1;
      if (clubAfter > maxPerTeam) continue;
      if (!best || c.horizon > best.horizon) best = c;
    }
    if (best && best.horizon - out.horizon > 0.3) {
      ideas.push({
        out,
        in: best,
        gainHorizon: best.horizon - out.horizon,
        gainNext: best.next - out.next,
        budgetLeftTenths: budget - best.priceTenths,
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
