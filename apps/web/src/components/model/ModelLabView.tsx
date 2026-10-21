import Link from "next/link";
import { Panel, StatTile } from "@/components/ui";
import type { LabData, ModelSeason } from "@/lib/data/models";

const LINE_COLORS = ["#a78bfa", "#34d399", "#fbbf24", "#60a5fa"]; // 3 teratas + model aktif

const f1 = (v: number | null) => (v == null ? "-" : v.toFixed(1));
const f2 = (v: number | null) => (v == null ? "-" : v.toFixed(2));

/** Grafik garis SVG: poin simulasi musim kumulatif per GW. Tiga teratas & model aktif berwarna. */
function CumulativeChart({ models, highlight }: { models: ModelSeason[]; highlight: string[] }) {
  const W = 720;
  const H = 240;
  const P = { l: 40, r: 12, t: 10, b: 24 };
  const gws = [...new Set(models.flatMap((m) => m.curve.map((c) => c.gw)))].sort((a, b) => a - b);
  if (gws.length < 2) return <p className="text-sm text-[var(--text-muted)]">Needs at least two tested gameweeks.</p>;
  const maxY = Math.max(...models.flatMap((m) => m.curve.map((c) => c.total)), 1);
  const x = (gw: number) => P.l + ((gw - gws[0]) / (gws[gws.length - 1] - gws[0])) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / maxY) * (H - P.t - P.b);
  const path = (m: ModelSeason) => m.curve.map((c, i) => `${i ? "L" : "M"}${x(c.gw).toFixed(1)},${y(c.total).toFixed(1)}`).join(" ");
  const ordered = [...models].sort((a, b) => Number(highlight.includes(a.model)) - Number(highlight.includes(b.model)));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="Cumulative season simulation points">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(maxY * t)} y2={y(maxY * t)} stroke="rgba(255,255,255,0.06)" />
            <text x={P.l - 6} y={y(maxY * t) + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">
              {Math.round(maxY * t)}
            </text>
          </g>
        ))}
        {gws.filter((_, i) => i % Math.ceil(gws.length / 12) === 0).map((gw) => (
          <text key={gw} x={x(gw)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
            GW{gw}
          </text>
        ))}
        {ordered.map((m) => {
          const i = highlight.indexOf(m.model);
          return (
            <path key={m.model} d={path(m)} fill="none" stroke={i >= 0 ? LINE_COLORS[i] : "rgba(255,255,255,0.15)"} strokeWidth={i >= 0 ? 2.5 : 1.2}>
              <title>
                {m.label}: {m.simTotal} pts
              </title>
            </path>
          );
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs">
        {highlight.map((name, i) => {
          const m = models.find((x) => x.model === name);
          return m ? (
            <li key={name} className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full" style={{ background: LINE_COLORS[i] }} />
              {m.label}
            </li>
          ) : null;
        })}
        <li className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <span className="h-0.5 w-4 bg-white/20" />
          other models
        </li>
      </ul>
    </div>
  );
}

export function ModelLabView({ data, season }: { data: LabData; season: string | null }) {
  if (!data.seasons.length) {
    return (
      <Panel title="Model Lab" subtitle="Several prediction models tested on the same past gameweeks">
        <p className="text-sm text-[var(--text-muted)]">No results yet. The worker runs the model_lab job after each finished gameweek.</p>
      </Panel>
    );
  }
  // Default: musim dengan GW teruji terbanyak (hasil paling bermakna).
  const longest = [...data.seasons].sort((a, b) => (data.bySeason[b][0]?.gws ?? 0) - (data.bySeason[a][0]?.gws ?? 0))[0];
  const current = season && data.bySeason[season] ? season : longest;
  const models = data.bySeason[current];
  const activeName = data.active?.name?.replace(/^lab:/, "") ?? "v1_tactics";
  const top3 = models.filter((m) => !m.benchmark).slice(0, 3).map((m) => m.model);
  const highlight = top3.includes(activeName) ? top3 : [...top3, activeName];
  const best = models.find((m) => !m.benchmark) ?? models[0];
  const bestBy = (key: keyof ModelSeason, dir: 1 | -1) =>
    models.reduce<ModelSeason | null>((b, m) => (m[key] == null ? b : !b || dir * ((m[key] as number) - (b[key] as number)) > 0 ? m : b), null)?.model;
  const bestFh = bestBy("fhTotal", 1);
  const bestMae = bestBy("mae", -1);
  const bestRho = bestBy("spearman", 1);
  const active = models.find((m) => m.model === activeName);

  return (
    <main className="flex flex-col gap-6">
      <Panel
        title="Model Lab"
        subtitle="Twelve ways of predicting FPL points, each tested only with information available before every deadline, then turned into real FPL decisions"
        action={
          <div className="flex gap-2">
            {data.seasons.map((s) => (
              <Link
                key={s}
                href={`/model?season=${encodeURIComponent(s)}`}
                className={`rounded-full px-3 py-1 text-sm ${s === current ? "bg-[var(--accent)] text-white" : "bg-white/5 hover:bg-white/10"}`}
              >
                {s}
              </Link>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Best season simulation" value={best.label} hint={`${best.simTotal} pts over ${best.gws} GWs`} />
          <StatTile
            label="Model in use"
            value={active?.label ?? activeName}
            hint={data.active?.mode === "auto" ? "auto: lab champion" : `${active ? `${active.simTotal} pts here · ` : ""}manual choice`}
          />
          <StatTile label="Gap: best vs model in use" value={active ? `${best.simTotal - active.simTotal >= 0 ? "+" : ""}${best.simTotal - active.simTotal}` : "-"} hint="season simulation points" />
          <StatTile label="Gameweeks tested" value={best.gws} hint={current} />
        </div>
      </Panel>

      <Panel title="Leaderboard" subtitle="Ranked by season simulation points. Green = best in column.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr>
                <th className="py-1 text-left">#</th>
                <th className="text-left">Model</th>
                <th className="text-right" title="£100m squad, 1 free transfer a week, −4 hits, captain; actual FPL points">Season sim</th>
                <th className="text-right">Per GW</th>
                <th className="text-right">Hits</th>
                <th className="text-right" title="Best £100m squad picked fresh each week (pure ranking quality)">Weekly Free Hit</th>
                <th className="text-right" title="Average absolute error of predicted vs actual points (lower is better)">MAE</th>
                <th className="text-right" title="Rank correlation predicted vs actual (1 = perfect order)">Spearman</th>
                <th className="text-right" title="Average actual points of the model's 10 highest projections">Top-10 pts</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m, i) => (
                <tr key={m.model} className={`border-t border-white/5 align-top tabular-nums ${m.model === activeName ? "bg-[var(--accent-soft)]" : ""}`}>
                  <td className="py-2">{i + 1}</td>
                  <td className="max-w-md py-2 pr-3">
                    <p className="font-medium">
                      {m.label}
                      {m.model === activeName && <span className="ml-2 rounded-full bg-[var(--accent)] px-2 text-[10px] text-white">in use</span>}
                      {m.kind === "ensemble" && <span className="ml-2 rounded-full bg-white/10 px-2 text-[10px]">ensemble</span>}
                      {m.benchmark && <span className="ml-2 rounded-full bg-amber-500/20 px-2 text-[10px] text-amber-200">benchmark only</span>}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{m.idea}</p>
                  </td>
                  <td className={`py-2 text-right font-semibold ${i === 0 ? "text-green-300" : ""}`}>{m.simTotal}</td>
                  <td className="py-2 text-right">{m.simPerGw.toFixed(1)}</td>
                  <td className="py-2 text-right">{m.hits}</td>
                  <td className={`py-2 text-right ${m.model === bestFh ? "text-green-300" : ""}`}>{m.fhTotal}</td>
                  <td className={`py-2 text-right ${m.model === bestMae ? "text-green-300" : ""}`}>{f2(m.mae)}</td>
                  <td className={`py-2 text-right ${m.model === bestRho ? "text-green-300" : ""}`}>{f2(m.spearman)}</td>
                  <td className="py-2 text-right">{f1(m.top10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="min-w-0 xl:col-span-2" title="Season simulation over time" subtitle="Cumulative actual points if you had followed each model every week">
          <CumulativeChart models={models} highlight={highlight} />
        </Panel>
        <Panel title="Learned ensemble weights" subtitle={`Non-negative least squares on ${data.gwsLearned} past gameweeks — how much each model contributes`}>
          {data.weights.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Learning starts after three tested gameweeks.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.weights.map((w) => {
                const label = models.find((m) => m.model === w.model)?.label ?? w.model;
                return (
                  <li key={w.model} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate">{label}</span>
                    <span className="h-2 flex-1 rounded-full bg-white/5">
                      <span className="block h-2 rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(w.weight * 100)}%` }} />
                    </span>
                    <span className="w-10 text-right tabular-nums">{Math.round(w.weight * 100)}%</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="How to read and switch">
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">
          <li>
            <b>Season sim</b> is the closest to real play: start with a £100m squad, one free transfer a week (up to 5 banked), a −4 hit only when the
            model sees a clear gain, captain = highest projection, automatic substitutions. No chips. Selling price = current price.
          </li>
          <li>
            <b>Weekly Free Hit</b> picks the best £100m squad fresh every week, so it measures pure ranking quality. <b>MAE</b> and <b>Spearman</b> judge
            the raw predictions.
          </li>
          <li>Every model only sees data from before each deadline (point-in-time). FPL xP exists only for past seasons.</li>
          <li>
            Switch the model used for projections from GitHub Actions → <b>worker-tick</b> → Run workflow with jobs{" "}
            <code className="rounded bg-black/30 px-1">set_active_model:name=auto run_projections</code> (auto = lab champion), or any model id such as{" "}
            <code className="rounded bg-black/30 px-1">ensemble_stack</code>, <code className="rounded bg-black/30 px-1">crowd</code>,{" "}
            <code className="rounded bg-black/30 px-1">v1_tactics</code>.
          </li>
        </ul>
      </Panel>
    </main>
  );
}
