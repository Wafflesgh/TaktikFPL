import "server-only";
import { createClient } from "@/lib/supabase/server";

export type LabRow = { model: string; metric: string; value: number; season: string; gw: number; detail: Record<string, unknown> };

export type ModelSeason = {
  model: string;
  label: string;
  idea: string;
  kind: string;
  gws: number;
  simTotal: number;
  simPerGw: number;
  hits: number;
  fhTotal: number;
  mae: number | null;
  spearman: number | null;
  top10: number | null;
  /** Poin simulasi musim kumulatif per GW (untuk grafik). */
  curve: { gw: number; total: number }[];
};

export type LabData = {
  seasons: string[];
  bySeason: Record<string, ModelSeason[]>;
  weights: { model: string; weight: number }[];
  gwsLearned: number;
  active: { name: string; mode: string; info: Record<string, unknown> } | null;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Hasil job model_lab (model_evaluations 'lab:*'), diringkas per musim per model. */
export async function getLabData(): Promise<LabData> {
  const supabase = await createClient();
  const rows: LabRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("model_evaluations")
      .select("model_version, metric, value, detail")
      .like("model_version", "lab:%")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) {
      const d = (r.detail ?? {}) as Record<string, unknown>;
      rows.push({ model: r.model_version.slice(4), metric: r.metric, value: Number(r.value), season: String(d.season ?? ""), gw: Number(d.gw ?? 0), detail: d });
    }
    if (data.length < 1000) break;
  }

  const weightRows = rows.filter((r) => r.model === "weights" && !r.metric.startsWith("_"));
  const total = weightRows.reduce((s, r) => s + r.value, 0);
  const weights = weightRows
    .map((r) => ({ model: r.metric, weight: total > 0 ? r.value / total : 0 }))
    .filter((w) => w.weight > 0.001)
    .sort((a, b) => b.weight - a.weight);
  const gwsLearned = Number(weightRows[0]?.detail.gws_learned ?? 0);

  const bySeason: Record<string, ModelSeason[]> = {};
  const groups = new Map<string, LabRow[]>();
  for (const r of rows) {
    if (r.model === "weights" || !r.season) continue;
    const key = `${r.season}|${r.model}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rs] of groups) {
    const [season, model] = key.split("|");
    const by = (m: string) => rs.filter((r) => r.metric === m).sort((a, b) => a.gw - b.gw);
    const totals = by("sim_total");
    if (!totals.length) continue;
    const meta = totals[totals.length - 1].detail;
    const last = totals[totals.length - 1];
    bySeason[season] = [
      ...(bySeason[season] ?? []),
      {
        model,
        label: String(meta.label ?? model),
        idea: String(meta.idea ?? ""),
        kind: String(meta.kind ?? ""),
        gws: totals.length,
        simTotal: last.value,
        simPerGw: last.value / totals.length,
        hits: by("sim_hits").at(-1)?.value ?? 0,
        fhTotal: by("fh_points").reduce((s, r) => s + r.value, 0),
        mae: avg(by("mae_xpts").map((r) => r.value)),
        spearman: avg(by("spearman").map((r) => r.value)),
        top10: avg(by("top10_actual_avg").map((r) => r.value)),
        curve: totals.map((r) => ({ gw: r.gw, total: r.value })),
      },
    ];
  }
  for (const s of Object.keys(bySeason)) bySeason[s].sort((a, b) => b.simTotal - a.simTotal);
  const seasons = Object.keys(bySeason).sort().reverse();

  const { data: run } = await supabase.from("model_runs").select("notes").eq("status", "ok").order("id", { ascending: false }).limit(1).maybeSingle();
  const notes = (run?.notes ?? {}) as { active_model?: string; active_info?: Record<string, unknown> };
  const active = notes.active_model
    ? { name: notes.active_model, mode: String(notes.active_info?.mode ?? "manual"), info: notes.active_info ?? {} }
    : null;
  return { seasons, bySeason, weights, gwsLearned, active };
}
