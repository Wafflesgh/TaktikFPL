import { formationOf } from "@/lib/positions";

export type LineupRow = { fixture_id: number; team_id: number; player_id: number; is_starter: boolean; position_label: string | null };

export type XiPlayer = { playerId: number; slot: string; startsInSlot: number; starts: number };

export type UsualXi = {
  formation: string | null;
  /** Formasi per laga (terbaru dulu) → dipakai untuk "formation usage". */
  usage: { formation: string; matches: number }[];
  sample: number;
  players: XiPlayer[];
  /** Starter tiap laga: fixture → set pemain (untuk mendeteksi pemain inti yang absen). */
  startersBy: Map<number, Set<number>>;
};

/**
 * XI utama dari lineup N laga terakhir: formasi tersering, lalu tiap slot formasi itu diisi pemain
 * dengan start terbanyak di slot tersebut (seri → total start). Tanpa ambang/nama hardcode.
 */
export function usualXi(rows: LineupRow[], fixtureOrder: number[]): UsualXi {
  const starters = rows.filter((r) => r.is_starter && r.position_label && r.position_label !== "Sub");
  const byFx = new Map<number, LineupRow[]>();
  for (const r of starters) byFx.set(r.fixture_id, [...(byFx.get(r.fixture_id) ?? []), r]);
  const fxs = fixtureOrder.filter((f) => byFx.has(f)); // terbaru dulu
  const formations = new Map<number, string | null>(
    fxs.map((f) => [f, formationOf(byFx.get(f)!.filter((r) => r.position_label !== "GK").map((r) => r.position_label!))]),
  );
  const count = new Map<string, number>();
  for (const f of formations.values()) if (f) count.set(f, (count.get(f) ?? 0) + 1);
  const usage = [...count.entries()].map(([formation, matches]) => ({ formation, matches })).sort((a, b) => b.matches - a.matches);
  const formation = usage[0]?.formation ?? null;

  const starts = new Map<number, number>();
  const slotStarts = new Map<string, number>(); // `${player}:${slot}`
  for (const f of fxs)
    for (const r of byFx.get(f)!) {
      starts.set(r.player_id, (starts.get(r.player_id) ?? 0) + 1);
      const k = `${r.player_id}:${r.position_label}`;
      slotStarts.set(k, (slotStarts.get(k) ?? 0) + 1);
    }

  // Slot target = susunan laga terbaru dengan formasi tersering.
  const templateFx = fxs.find((f) => formations.get(f) === formation) ?? fxs[0];
  const template = templateFx != null ? byFx.get(templateFx)!.map((r) => r.position_label!) : [];
  const used = new Set<number>();
  const players: XiPlayer[] = [];
  const candidates = [...starts.keys()];
  for (const slot of template) {
    const best = candidates
      .filter((p) => !used.has(p))
      .map((p) => ({ p, s: slotStarts.get(`${p}:${slot}`) ?? 0, t: starts.get(p) ?? 0 }))
      .filter((c) => c.s > 0)
      .sort((a, b) => b.s - a.s || b.t - a.t)[0];
    if (!best) continue;
    used.add(best.p);
    players.push({ playerId: best.p, slot, startsInSlot: best.s, starts: best.t });
  }
  return {
    formation,
    usage,
    sample: fxs.length,
    players,
    startersBy: new Map(fxs.map((f) => [f, new Set(byFx.get(f)!.map((r) => r.player_id))])),
  };
}
