import { Reasons } from "@/components/Reasons";
import type { Reason } from "@/lib/reco";

/** Rincian proyeksi satu pemain untuk satu GW (dari component_breakdown xPts v1). */
export type XptsBreakdown = Record<string, number | boolean | string | unknown>;

const COMPONENTS: [string, string][] = [
  ["c_appearance", "Minutes played"],
  ["c_goals", "Goals"],
  ["c_assists", "Assists"],
  ["c_clean_sheet", "Clean sheet"],
  ["c_conceded", "Goals conceded"],
  ["c_saves", "Saves"],
  ["c_bonus", "Bonus"],
  ["c_defcon", "Defensive contributions"],
  ["c_cards", "Cards"],
];

const PROBS: [string, string][] = [
  ["p60", "Plays 60+ mins"],
  ["p_goal", "Scores"],
  ["p_assist", "Assists"],
  ["p_cs", "Clean sheet (incl. 60+ mins)"],
  ["p_defcon", "Defcon bonus"],
];

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

/** Gabungkan laga satu GW (DGW = jumlah xPts; probabilitas ditampilkan per laga pertama). */
export function XptsDetail({ fixtures, reasons }: { fixtures: XptsBreakdown[]; reasons: Reason[] }) {
  if (!fixtures.length) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-[var(--text-muted)] hover:text-white">Full breakdown</summary>
      <XptsBreakdownBody fixtures={fixtures} reasons={reasons} className="mt-2" />
    </details>
  );
}

/** Isi rincian (tanpa expand): sumber xPts, peluang, model laga, dan semua alasan. */
export function XptsBreakdownBody({ fixtures, reasons, className = "" }: { fixtures: XptsBreakdown[]; reasons: Reason[]; className?: string }) {
  if (!fixtures.length) return null;
  const sum = (k: string) => fixtures.reduce((s, f) => s + n(f[k]), 0);
  const first = fixtures[0];
  return (
      <div className={`grid gap-3 rounded-xl bg-black/20 p-3 text-xs sm:grid-cols-3 ${className}`}>
        <div>
          <p className="mb-1 font-semibold">xPts by source</p>
          <table className="w-full tabular-nums">
            <tbody>
              {COMPONENTS.filter(([k]) => Math.abs(sum(k)) >= 0.005).map(([k, label]) => (
                <tr key={k}>
                  <td className="text-[var(--text-muted)]">{label}</td>
                  <td className="text-right">
                    {sum(k) >= 0 ? "+" : ""}
                    {sum(k).toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-white/10 font-semibold">
                <td>Total</td>
                <td className="text-right">{sum("xpts").toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <p className="mb-1 font-semibold">Chances{fixtures.length > 1 ? " (1st match)" : ""}</p>
          <table className="w-full tabular-nums">
            <tbody>
              {PROBS.filter(([k]) => first[k] != null).map(([k, label]) => (
                <tr key={k}>
                  <td className="text-[var(--text-muted)]">{label}</td>
                  <td className="text-right">{Math.round(n(first[k]) * 100)}%</td>
                </tr>
              ))}
              <tr>
                <td className="text-[var(--text-muted)]">Expected minutes</td>
                <td className="text-right">{Math.round(sum("xmins"))}</td>
              </tr>
              <tr>
                <td className="text-[var(--text-muted)]">xG · xA</td>
                <td className="text-right">
                  {sum("xg").toFixed(2)} · {sum("xa").toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <p className="mb-1 font-semibold">Match model</p>
          <table className="w-full tabular-nums">
            <tbody>
              {fixtures.map((f, i) => (
                <tr key={i}>
                  <td className="text-[var(--text-muted)]">{f.home ? "Home" : "Away"} · goals for / against</td>
                  <td className="text-right">
                    {n(f.lam_team).toFixed(2)} / {n(f.lam_opp).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {fixtures.map((f, i) =>
            f.opp_style ? (
              <p key={`s${i}`} className="mt-1">
                Opponent style: <b>{String(f.opp_style).replace("_", " ")}</b> (PPDA {n(f.opp_ppda).toFixed(1)}) · player adjustment{" "}
                <b>
                  {n(f.style_mult || 1) >= 1 ? "+" : ""}
                  {Math.round((n(f.style_mult || 1) - 1) * 100)}%
                </b>
              </p>
            ) : null,
          )}
          <p className="mt-1 text-[var(--text-muted)]">
            Expected goals for each side, from both teams&apos; attack/defence strength (last 19 matches, xG-based) and home advantage.
          </p>
        </div>
        {reasons.length > 0 && (
          <div className="sm:col-span-3">
            <p className="mb-1 font-semibold">All reasons</p>
            <Reasons reasons={reasons} max={10} />
          </div>
        )}
      </div>
  );
}
