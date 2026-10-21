import { Panel } from "@/components/ui";
import type { PlayerTacticsJson } from "@/lib/data/tactics";
import { POSITION_NAME as ROLE } from "@/lib/positions";
import { formatWIB } from "@/lib/time";

const STYLE: [string, string, string][] = [
  ["low_block", "vs low blocks", "The third of teams that press least and defend deep (highest PPDA)"],
  ["mid_block", "vs mid blocks", "The middle third"],
  ["high_press", "vs high press", "The third of teams that press most (lowest PPDA)"],
];

/** Peran per laga & performa melawan gaya bertahan lawan (data Understat, ±2 musim terakhir). */
export function TacticalProfile({ data }: { data: { asOf: string; t: PlayerTacticsJson } | null }) {
  if (!data) {
    return (
      <Panel title="Tactical profile" subtitle="Roles and performance vs defensive styles">
        <p className="text-sm text-[var(--text-muted)]">No tactical data yet. The worker loads it from Understat daily.</p>
      </Panel>
    );
  }
  const { t } = data;
  const roles = Object.entries(t.roles).sort((a, b) => b[1] - a[1]);
  return (
    <Panel
      title="Tactical profile"
      subtitle={`Understat, last ~2 seasons · ${t.minutes.toLocaleString("en-GB")} mins · updated ${formatWIB(data.asOf)}`}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">Role in last {t.starts} starts</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {roles.map(([pos, share]) => (
              <li key={pos} className="flex items-center gap-2">
                <span className="w-36 shrink-0">
                  {ROLE[pos] ?? pos} <span className="text-xs text-[var(--text-muted)]">{pos}</span>
                </span>
                <span className="h-2 flex-1 rounded-full bg-white/5">
                  <span className="block h-2 rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(share * 100)}%` }} />
                </span>
                <span className="w-10 text-right tabular-nums">{Math.round(share * 100)}%</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-white/5 p-2">
              <p className="text-xs text-[var(--text-muted)]">xG+xA per 90</p>
              <p className="font-display text-xl">{t.xgi90.toFixed(2)}</p>
            </div>
            <div className="rounded-xl bg-white/5 p-2" title="xG of every possession the player was involved in, per 90">
              <p className="text-xs text-[var(--text-muted)]">xGChain per 90</p>
              <p className="font-display text-xl">{t.xg_chain90.toFixed(2)}</p>
            </div>
            <div className="col-span-2 rounded-xl bg-white/5 p-2">
              <p className="text-xs text-[var(--text-muted)]">Share of xG from set pieces (corners, free kicks, penalties)</p>
              <p className="font-display text-xl">{Math.round(t.set_piece_xg_share * 100)}%</p>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">Versus defensive styles</p>
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr>
                <th className="py-1 text-left">Opponent</th>
                <th className="text-right">Mins</th>
                <th className="text-right">xG+xA/90</th>
                <th className="text-right" title="Shrunk towards the player's own average, capped −15% to +20%; applied to xG/xA in projections">
                  Model
                </th>
              </tr>
            </thead>
            <tbody>
              {STYLE.map(([key, label, hint]) => {
                const s = t.split[key];
                return (
                  <tr key={key} className="border-t border-white/5" title={hint}>
                    <td className="py-1.5">{label}</td>
                    <td className="text-right">{s ? s.minutes.toLocaleString("en-GB") : "-"}</td>
                    <td className="text-right">{s ? s.xgi90.toFixed(2) : "-"}</td>
                    <td className={`text-right ${s && s.ratio >= 1.05 ? "text-green-300" : s && s.ratio <= 0.95 ? "text-amber-300" : ""}`}>
                      {s ? `${s.ratio >= 1 ? "+" : ""}${Math.round((s.ratio - 1) * 100)}%` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Styles come from each opponent&apos;s PPDA that season (opponent passes allowed per defensive action: high = sits deep). Small
            samples are pulled towards the player&apos;s overall rate, so the model only moves when the evidence is solid.
          </p>
        </div>
      </div>
    </Panel>
  );
}
