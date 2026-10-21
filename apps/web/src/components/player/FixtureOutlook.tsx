import Link from "next/link";
import { Insights, LevelChip } from "@/components/analysis/Insights";
import { FdrChip, TeamBadge } from "@/components/ui";
import type { FixtureOutlookRow } from "@/lib/data/outlook";
import { formatWIB } from "@/lib/time";

/** Laga mendatang: tingkat kesulitan (engine) + alasan per lawan; klik baris untuk rincian. */
export function FixtureOutlook({ rows }: { rows: FixtureOutlookRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">No upcoming fixtures.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="hidden grid-cols-[48px_minmax(140px,1fr)_40px_48px_170px_56px_minmax(0,2.4fr)] gap-3 px-3 text-xs text-[var(--text-muted)] lg:grid">
        <span>GW</span>
        <span>Opponent</span>
        <span>H/A</span>
        <span title="Official FPL difficulty">FDR</span>
        <span title="TaktikFPL difficulty for this player (1 = very favourable, 5 = very tough)">Difficulty</span>
        <span className="text-right" title="Engine expected points (active model)">xPts</span>
        <span>Why</span>
      </div>
      {rows.map(({ row, opp, xpts, outlook }, i) => (
        <details key={row.fx.id} open={i === 0} className="group rounded-2xl border border-[var(--glass-border)] bg-white/[0.03] open:bg-white/[0.05]">
          <summary className="grid cursor-pointer list-none grid-cols-[40px_1fr_auto] items-center gap-3 px-3 py-2.5 lg:grid-cols-[48px_minmax(140px,1fr)_40px_48px_170px_56px_minmax(0,2.4fr)]">
            <span className="font-semibold tabular-nums">{row.fx.gw ?? "-"}</span>
            <span className="flex min-w-0 items-center gap-2">
              <TeamBadge url={opp.badge} short={opp.short} size={26} />
              <span className="min-w-0">
                <Link href={`/klub/${opp.id}`} className="block truncate font-medium hover:text-[var(--accent)]">
                  {opp.name}
                </Link>
                <span className="block text-xs text-[var(--text-muted)]">{formatWIB(row.fx.kickoffUtc)}</span>
              </span>
            </span>
            <span className="text-[var(--text-muted)] max-lg:hidden">{row.home ? "H" : "A"}</span>
            <span className="max-lg:hidden">
              <FdrChip value={row.fdr} />
            </span>
            <span>
              <LevelChip level={outlook.level} label={outlook.label} />
            </span>
            <span className="text-right font-semibold tabular-nums max-lg:hidden">{xpts != null ? xpts.toFixed(1) : "-"}</span>
            <span className="col-span-3 text-sm text-[var(--text-muted)] lg:col-span-1">{outlook.summary}</span>
          </summary>
          <div className="border-t border-white/5 px-3 py-3">
            <Insights items={outlook.insights} />
          </div>
        </details>
      ))}
      <p className="text-xs text-[var(--text-muted)]">
        Difficulty is computed by the engine from opponent strength and form (fundamental) and from opponent style and the direct zone
        duel vs the player&apos;s main position (technical). Tap a fixture for the full reasoning.
      </p>
    </div>
  );
}
