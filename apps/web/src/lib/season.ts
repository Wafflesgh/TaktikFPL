// Rencana chip untuk squad pengguna — fungsi murni di atas matriks xPts dari worker (season_plan).
// Tidak membuat angka baru: hanya memilih XI, menjumlah, dan membandingkan proyeksi engine.

export type SeasonGwRow = {
  gw: number;
  dgw: string[];
  bgw: string[];
  template_xi: number;
  template_bench: number;
  template_captain: { id: number; name: string; xpts: number };
  fh_xi: number;
  fh_total?: number;
  fh_gain: number;
  wc?: { opt6: number; template6: number; raw_gain?: number; ft_value?: number; gain: number };
};

export type ChipOption = { gw: number; value: number; text: string };

export type ChipRec = {
  name: string;
  label: string;
  number: number;
  start_event: number;
  stop_event: number;
  recommended_gw: number;
  margin_vs_next: number | null;
  best: ChipOption[];
};

export type SeasonPlanJson = {
  kind: "season_plan";
  first_gw: number;
  last_gw: number;
  template: number[];
  gws: SeasonGwRow[];
  chips: ChipRec[];
  matrix: Record<string, number[]>;
};

const XI_MIN: Record<string, number> = { GKP: 1, DEF: 3, MID: 2, FWD: 1 };
const XI_MAX: Record<string, number> = { GKP: 1, DEF: 5, MID: 5, FWD: 3 };
const DISCOUNT = 0.85;
const WC_HORIZON = 6;

export type XiPick = { starters: number[]; bench: number[]; captain: number; value: number; benchValue: number; captainValue: number };

/** XI terbaik dari squad 15 (formasi FPL valid) — sama dengan pick_xi di worker. */
export function pickXi(squad: number[], value: (id: number) => number, position: Map<number, string>): XiPick {
  const byPos: Record<string, number[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const id of squad) byPos[position.get(id) ?? "MID"]?.push(id);
  for (const k of Object.keys(byPos)) byPos[k].sort((a, b) => value(b) - value(a));
  let best: number[] = [];
  let bestV = -Infinity;
  for (let d = XI_MIN.DEF; d <= XI_MAX.DEF; d++) {
    for (let m = XI_MIN.MID; m <= XI_MAX.MID; m++) {
      const f = 10 - d - m;
      if (f < XI_MIN.FWD || f > XI_MAX.FWD) continue;
      if (byPos.DEF.length < d || byPos.MID.length < m || byPos.FWD.length < f) continue;
      const xi = [...byPos.GKP.slice(0, 1), ...byPos.DEF.slice(0, d), ...byPos.MID.slice(0, m), ...byPos.FWD.slice(0, f)];
      const v = xi.reduce((s, id) => s + value(id), 0);
      if (v > bestV) [best, bestV] = [xi, v];
    }
  }
  const bench = squad.filter((id) => !best.includes(id));
  const captain = best.reduce((c, id) => (value(id) > value(c) ? id : c), best[0] ?? 0);
  return {
    starters: best,
    bench,
    captain,
    value: Math.max(0, bestV),
    benchValue: bench.reduce((s, id) => s + value(id), 0),
    captainValue: value(captain),
  };
}

export type UserGw = {
  gw: number;
  xi: number;
  bench: number;
  captain: { id: number; xpts: number };
  /** Free Hit: squad sekali pakai terbaik (XI + kapten) − XI + kapten Anda. */
  fhGain: number;
  /** Wildcard: squad 6 GW terbaik − squad Anda (6 GW), setelah dikurangi nilai free transfer biasa. */
  wcGain: number | null;
};

export type UserChip = ChipRec & {
  used: boolean;
  usedGw: number | null;
  pick: ChipOption | null;
  options: ChipOption[];
};

/** Angka per GW untuk squad pengguna + rekomendasi chip yang masih tersedia (satu chip per GW). */
export function userSeasonPlan(
  plan: SeasonPlanJson,
  squad: number[],
  position: Map<number, string>,
  name: Map<number, string>,
  chipsUsed: { name: string; event: number }[],
): { gws: UserGw[]; chips: UserChip[] } {
  const xp = (id: number, gw: number) => plan.matrix[String(id)]?.[gw - plan.first_gw] ?? 0;
  const horizon = (id: number, start: number) => {
    let s = 0;
    for (let g = start; g <= Math.min(plan.last_gw, start + WC_HORIZON - 1); g++) s += xp(id, g) * DISCOUNT ** (g - start);
    return s;
  };
  const gws: UserGw[] = plan.gws.map((r) => {
    const pick = pickXi(squad, (id) => xp(id, r.gw), position);
    const fhTotal = r.fh_total ?? r.fh_xi + r.template_captain.xpts;
    let wcGain: number | null = null;
    if (r.wc) {
      const mine = pickXi(squad, (id) => horizon(id, r.gw), position).value;
      wcGain = r.wc.opt6 - mine - (r.wc.ft_value ?? 0) * (r.gw - plan.first_gw);
    }
    return {
      gw: r.gw,
      xi: pick.value,
      bench: pick.benchValue,
      captain: { id: pick.captain, xpts: pick.captainValue },
      fhGain: fhTotal - (pick.value + pick.captainValue),
      wcGain,
    };
  });
  const byGw = new Map(gws.map((g) => [g.gw, g]));
  const rowByGw = new Map(plan.gws.map((r) => [r.gw, r]));

  const chips: UserChip[] = plan.chips.map((c) => {
    const usedEv = chipsUsed.find((u) => u.name === c.name && u.event >= c.start_event && u.event <= c.stop_event);
    const options: ChipOption[] = [];
    for (let g = Math.max(c.start_event, plan.first_gw); g <= c.stop_event; g++) {
      const u = byGw.get(g);
      const r = rowByGw.get(g);
      if (!u || !r) continue;
      const dgw = r.dgw.length ? `; DGW: ${r.dgw.slice(0, 6).join(", ")}` : "";
      const bgw = r.bgw.length ? `; ${r.bgw.length} teams blank` : "";
      if (c.name === "3xc") options.push({ gw: g, value: u.captain.xpts, text: `${name.get(u.captain.id) ?? "?"} projected ${u.captain.xpts.toFixed(1)} xPts${dgw}` });
      if (c.name === "bboost") options.push({ gw: g, value: u.bench, text: `your bench projected ${u.bench.toFixed(1)} xPts${dgw}` });
      if (c.name === "freehit") options.push({ gw: g, value: u.fhGain, text: `one-week squad beats yours by ${u.fhGain >= 0 ? "+" : ""}${u.fhGain.toFixed(1)} xPts${bgw}${dgw}` });
      if (c.name === "wildcard" && u.wcGain != null)
        options.push({ gw: g, value: u.wcGain, text: `best 6-GW squad gains ${u.wcGain >= 0 ? "+" : ""}${u.wcGain.toFixed(1)} xPts over yours (after normal free transfers)` });
    }
    options.sort((a, b) => b.value - a.value || a.gw - b.gw);
    return { ...c, used: Boolean(usedEv), usedGw: usedEv?.event ?? null, pick: null, options: options.slice(0, 5) };
  });

  // Satu chip per GW: tetapkan chip dengan nilai tertinggi lebih dulu, lalu yang lain menghindari GW itu.
  const taken = new Set<number>();
  const order = chips.filter((c) => !c.used && c.options.length).sort((a, b) => b.options[0].value - a.options[0].value);
  for (const c of order) {
    const opt = c.options.find((o) => !taken.has(o.gw)) ?? null;
    if (opt) taken.add(opt.gw);
    c.pick = opt;
  }
  return { gws, chips };
}
