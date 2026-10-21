import { Panel, StatTile } from "@/components/ui";
import type { GwAccuracy } from "@/lib/data/accuracy";

const fmt = (v: number | undefined, d = 2) => (v == null ? "-" : v.toFixed(d));

function avg(rows: GwAccuracy[], side: "model" | "baseline", metric: string): number | undefined {
  const vals = rows.map((r) => r[side][metric]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
}

/** Akurasi xPts v1 (backtest point-in-time) vs baseline "rata-rata poin 4 laga terakhir". */
export function ModelAccuracy({ rows }: { rows: GwAccuracy[] }) {
  if (rows.length === 0) {
    return (
      <Panel title="Model accuracy" subtitle="Backtest of finished gameweeks">
        <p className="text-sm text-[var(--text-muted)]">No evaluation yet — the worker runs evaluate_model daily.</p>
      </Panel>
    );
  }
  const maeModel = avg(rows, "model", "mae_xpts");
  const maeBase = avg(rows, "baseline", "mae_xpts");
  const rhoModel = avg(rows, "model", "spearman");
  const rhoBase = avg(rows, "baseline", "spearman");
  const better = maeModel != null && maeBase != null && maeModel < maeBase;
  return (
    <Panel
      title="Model accuracy"
      subtitle="xPts v1 backtested on each finished GW using only data available before its deadline, vs a naive baseline (average points over the last 4 matches)"
    >
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Avg error (MAE) · model" value={fmt(maeModel)} hint={`baseline ${fmt(maeBase)}${better ? " · model better" : ""}`} />
        <StatTile label="Ranking (Spearman) · model" value={fmt(rhoModel)} hint={`baseline ${fmt(rhoBase)} · 1 = perfect order`} />
        <StatTile label="Model top-10 avg pts" value={fmt(avg(rows, "model", "top10_actual_avg"), 1)} hint={`best possible ${fmt(avg(rows, "model", "top10_best_avg"), 1)}`} />
        <StatTile label="Gameweeks tested" value={rows.length} hint={`GW${rows[0].gw}–GW${rows[rows.length - 1].gw}`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-[var(--text-muted)]">
            <tr>
              <th className="py-1 text-left">GW</th>
              <th className="text-right">MAE model</th>
              <th className="text-right">MAE baseline</th>
              <th className="text-right">Spearman model</th>
              <th className="text-right">Spearman baseline</th>
              <th className="text-right" title="Average actual points of the model's 10 highest projections">Top-10 pts</th>
              <th className="text-right">Players</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.gw} className="border-t border-white/5 tabular-nums">
                <td className="py-1.5">GW{r.gw}</td>
                <td className={`text-right ${r.model.mae_xpts < r.baseline.mae_xpts ? "text-green-300" : ""}`}>{fmt(r.model.mae_xpts)}</td>
                <td className="text-right">{fmt(r.baseline.mae_xpts)}</td>
                <td className={`text-right ${r.model.spearman > r.baseline.spearman ? "text-green-300" : ""}`}>{fmt(r.model.spearman)}</td>
                <td className="text-right">{fmt(r.baseline.spearman)}</td>
                <td className="text-right">{fmt(r.model.top10_actual_avg, 1)}</td>
                <td className="text-right">{fmt(r.model.n_players, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">Lower MAE and higher Spearman are better. Green = model beats the baseline that GW.</p>
    </Panel>
  );
}
