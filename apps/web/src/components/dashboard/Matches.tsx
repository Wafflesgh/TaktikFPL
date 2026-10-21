import { AlertIcon } from "@/components/icons";
import { FdrChip, Panel, TeamBadge, TeamLink } from "@/components/ui";
import type { FixtureRow, StandingRow } from "@/lib/data/dashboard";
import { formatDayWIB, formatTimeWIB, formatWIB } from "@/lib/time";

/** Kartu laga besar kolom kanan (ref-02 "Live Matches"): laga live, atau laga berikutnya. */
export function NextMatchCard({ live, next }: { live: FixtureRow[]; next: FixtureRow | null }) {
  const match = live[0] ?? next;
  const isLive = live.length > 0;
  return (
    <Panel
      title={isLive ? "Live Match" : "Next Match"}
      subtitle={match?.gw ? `Gameweek ${match.gw}` : undefined}
      action={
        isLive ? (
          <span className="flex items-center gap-2 rounded-full bg-[var(--live-red)]/20 px-3 py-1 text-xs font-semibold text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--live-red)]" /> LIVE
          </span>
        ) : undefined
      }
    >
      {!match ? (
        <p className="text-sm text-[var(--text-muted)]">No fixtures yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <div className="flex flex-col items-center gap-2">
              <TeamBadge url={match.home?.badge ?? null} short={match.home?.short ?? null} size={64} />
              <TeamLink team={match.home} className="font-semibold">{match.home?.name}</TeamLink>
            </div>
            <div>
              {isLive ? (
                <p className="font-display text-5xl leading-none">
                  {match.homeGoals ?? 0} - {match.awayGoals ?? 0}
                </p>
              ) : (
                <p className="font-display text-4xl leading-none text-[var(--text-muted)]">VS</p>
              )}
              <p className="mt-2 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs">{formatTimeWIB(match.kickoffUtc)}</p>
            </div>
            <div className="flex flex-col items-center gap-2">
              <TeamBadge url={match.away?.badge ?? null} short={match.away?.short ?? null} size={64} />
              <TeamLink team={match.away} className="font-semibold">{match.away?.name}</TeamLink>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-[var(--text-muted)]">{formatWIB(match.kickoffUtc)}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
            {["Timeline", "Lineup", "Stats", "Insight"].map((t) => (
              <span key={t} className="cursor-not-allowed rounded-full bg-white/5 px-3 py-1.5 text-[var(--text-muted)]" title="Live Match Center — Phase 3">
                {t}
              </span>
            ))}
          </div>
          <button
            type="button"
            disabled
            title="Live Match Center — Phase 3"
            className="mt-4 w-full rounded-full bg-[var(--accent)] py-3 font-semibold text-white opacity-80"
          >
            Open Match Center
          </button>
        </>
      )}
    </Panel>
  );
}

/** Daftar jadwal GW berikut dikelompokkan per hari WIB (ref-02 "Upcoming Matches"). */
export function FixtureGrid({ fixtures }: { fixtures: FixtureRow[] }) {
  if (fixtures.length === 0) return <p className="text-sm text-[var(--text-muted)]">No fixtures yet.</p>;
  const byDay = new Map<string, FixtureRow[]>();
  for (const f of fixtures) {
    const key = f.kickoffUtc ? formatDayWIB(f.kickoffUtc) : "Not scheduled";
    byDay.set(key, [...(byDay.get(key) ?? []), f]);
  }
  return (
    <div className="flex flex-col gap-4">
      {[...byDay.entries()].map(([day, list]) => (
        <div key={day}>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">{day}</p>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            {list.map((f) => (
              <article
                key={f.id}
                className={`flex items-center gap-3 rounded-2xl border bg-white/[0.04] p-3 ${f.recentlyChanged ? "border-amber-400/50" : "border-[var(--glass-border)]"}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <TeamBadge url={f.home?.badge ?? null} short={f.home?.short ?? null} size={32} />
                  <TeamLink team={f.home} className="font-semibold">{f.home?.short}</TeamLink>
                  <FdrChip value={f.fdrHome} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold tabular-nums">{formatTimeWIB(f.kickoffUtc)}</p>
                  {f.recentlyChanged && (
                    <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-amber-300" title="Schedule changed in the last 7 days">
                      <AlertIcon size={12} /> changed
                    </p>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                  <FdrChip value={f.fdrAway} />
                  <TeamLink team={f.away} className="font-semibold">{f.away?.short}</TeamLink>
                  <TeamBadge url={f.away?.badge ?? null} short={f.away?.short ?? null} size={32} />
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Klasemen PL dihitung dari hasil fixture (ref-02 "Group Standing"). */
export function StandingsTable({ rows }: { rows: StandingRow[] }) {
  return (
    <Panel title="Table" subtitle="Computed from final results">
      <table className="w-full text-sm">
        <thead className="text-xs text-[var(--text-muted)]">
          <tr>
            <th className="w-6 py-1 text-left">#</th>
            <th className="text-left">Team</th>
            <th className="text-right">P</th>
            <th className="text-right">GD</th>
            <th className="text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team.id} className="border-t border-white/5">
              <td className="py-1.5 text-[var(--text-muted)]">{i + 1}</td>
              <td>
                <span className="flex items-center gap-2">
                  <TeamBadge url={r.team.badge} short={r.team.short} size={22} />
                  <TeamLink team={r.team}>{r.team.short}</TeamLink>
                </span>
              </td>
              <td className="text-right tabular-nums">{r.played}</td>
              <td className="text-right tabular-nums">{r.gf - r.ga > 0 ? `+${r.gf - r.ga}` : r.gf - r.ga}</td>
              <td className="text-right font-semibold tabular-nums">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
