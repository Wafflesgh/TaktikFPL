import Link from "next/link";
import { FdrChip, TeamBadge, TeamLink } from "@/components/ui";
import type { TeamInfo } from "@/lib/data/dashboard";
import type { GwRow, SeasonSummary } from "@/lib/data/player";
import { formatWIB } from "@/lib/time";

const dec = (v: number | null, digits = 2) => (v == null ? "-" : v.toFixed(digits));
const th = "px-2 py-2 text-right font-medium";
const td = "px-2 py-2 text-right tabular-nums";

export type UpcomingRow = { fixtureId: number; gw: number | null; kickoffUtc: string | null; opponent: TeamInfo; home: boolean; fdr: number | null };

/**
 * Seluruh laga musim ini GW1→GW38: yang sudah dimainkan (posisi Understat + poin) lalu jadwal sisa
 * (FDR, redup). Baris 4 GW terakhir disorot. Tabel menggulir di dalam panel.
 */
export function GwTable({
  rows,
  highlight,
  positions,
  upcoming = [],
}: {
  rows: GwRow[];
  highlight: Set<number>;
  positions?: Map<number, string>;
  upcoming?: UpcomingRow[];
}) {
  if (rows.length === 0 && upcoming.length === 0) return <p className="text-sm text-[var(--text-muted)]">No matches this season yet.</p>;
  const total = (f: (r: GwRow) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const xg = rows.some((r) => r.xg != null) ? total((r) => r.xg ?? 0) : null;
  const xa = rows.some((r) => r.xa != null) ? total((r) => r.xa ?? 0) : null;

  return (
    <div className="-mx-5 max-h-[640px] overflow-auto px-5">
      <table className="w-full min-w-[600px] text-sm">
        <thead className="sticky top-0 bg-[var(--bg-elev)] text-xs text-[var(--text-muted)]">
          <tr>
            <th className="py-2 pr-2 text-left font-medium">GW</th>
            <th className="px-2 py-2 text-left font-medium">Opponent</th>
            <th className="px-2 py-2 text-center font-medium" title="Home (H) / away (A)">H/A</th>
            <th className="px-2 py-2 text-left font-medium" title="Position slot played (Understat lineup)">Pos</th>
            <th className={th}>Mins</th>
            <th className={th}>Pts</th>
            <th className={th} title="Goals">G</th>
            <th className={th} title="Assist">A</th>
            <th className={th}>Bonus</th>
            <th className={th}>xG</th>
            <th className={`${th} pr-0`}>xA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.fixtureId}
              className={`border-t border-white/5 ${highlight.has(r.gw) ? "bg-[var(--accent-soft)]" : "hover:bg-white/[0.03]"}`}
            >
              <td className="py-2 pr-2 font-medium tabular-nums">{r.gw}</td>
              <td className="px-2 py-2" title={formatWIB(r.kickoffUtc)}>
                <TeamCell team={r.opponent} />
              </td>
              <td className="px-2 py-2 text-center text-[var(--text-muted)]">{r.home == null ? "-" : r.home ? "H" : "A"}</td>
              <td className="px-2 py-2 text-xs">
                {positions?.get(r.fixtureId) ?? <span className="text-[var(--text-muted)]">{r.minutes > 0 ? "?" : "-"}</span>}
              </td>
              <td className={`${td} ${r.minutes === 0 ? "text-[var(--text-muted)]" : ""}`}>{r.minutes}</td>
              <td className={`${td} font-semibold`} title={r.isFinal ? undefined : "Provisional — bonus/points not final"}>
                {r.points}
                {!r.isFinal && <span className="text-[var(--text-muted)]">*</span>}
              </td>
              <td className={td}>{r.goals}</td>
              <td className={td}>{r.assists}</td>
              <td className={td}>{r.bonus}</td>
              <td className={td}>{dec(r.xg)}</td>
              <td className={`${td} pr-0`}>{dec(r.xa)}</td>
            </tr>
          ))}
          {upcoming.map((u) => (
            <tr key={u.fixtureId} className="border-t border-white/5 text-[var(--text-muted)]">
              <td className="py-2 pr-2 tabular-nums">{u.gw ?? "-"}</td>
              <td className="px-2 py-2" title={formatWIB(u.kickoffUtc)}>
                <TeamCell team={u.opponent} />
              </td>
              <td className="px-2 py-2 text-center">{u.home ? "H" : "A"}</td>
              <td className="px-2 py-2" colSpan={7}>
                <span className="flex items-center gap-2 text-xs">
                  <FdrChip value={u.fdr} /> {formatWIB(u.kickoffUtc)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-white/15 font-semibold">
          <tr>
            <td className="py-2 pr-2" colSpan={4}>
              Total · {rows.length} matches
            </td>
            <td className={td}>{total((r) => r.minutes)}</td>
            <td className={td}>{total((r) => r.points)}</td>
            <td className={td}>{total((r) => r.goals)}</td>
            <td className={td}>{total((r) => r.assists)}</td>
            <td className={td}>{total((r) => r.bonus)}</td>
            <td className={td}>{dec(xg)}</td>
            <td className={`${td} pr-0`}>{dec(xa)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TeamCell({ team }: { team: TeamInfo | null }) {
  const inner = (
    <span className="flex items-center gap-2">
      <TeamBadge url={team?.badge ?? null} short={team?.short ?? null} size={24} />
      {team?.short ?? "?"}
    </span>
  );
  return team ? (
    <Link href={`/klub/${team.id}`} className="hover:text-[var(--accent)]">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Ringkasan per musim (2016/17–sekarang). xGI hanya untuk musim yang punya data expected. */
export function SeasonTable({ rows }: { rows: SeasonSummary[] }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">No season history yet.</p>;
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[540px] text-sm">
        <thead className="text-xs text-[var(--text-muted)]">
          <tr>
            <th className="py-2 pr-2 text-left font-medium">Season</th>
            <th className="px-2 py-2 text-left font-medium">Club</th>
            <th className={th}>Pts</th>
            <th className={th}>Mins</th>
            <th className={th} title="Matches with minutes > 0">Apps</th>
            <th className={th} title="Goals">G</th>
            <th className={th} title="Assist">A</th>
            <th className={th} title="Points per 90 minutes">Pts/90</th>
            <th className={`${th} pr-0`} title="xG + xA (available since 2022/23)">xGI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.seasonId} className={`border-t border-white/5 ${s.isCurrent ? "bg-white/[0.04]" : "hover:bg-white/[0.03]"}`}>
              <td className="whitespace-nowrap py-2 pr-2 font-medium tabular-nums">
                {s.label}
                {s.isCurrent && <span className="ml-2 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium">current</span>}
              </td>
              <td className="px-2 py-2">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  {s.teams.length === 0
                    ? "-"
                    : s.teams.map((t) => (
                        <span key={t.id} className="flex items-center gap-1.5" title={t.name}>
                          <TeamBadge url={t.badge} short={t.short} size={20} />
                          <TeamLink team={t} className="text-xs">{t.short}</TeamLink>
                        </span>
                      ))}
                </span>
              </td>
              <td className={`${td} font-semibold`}>{s.points}</td>
              <td className={td}>{s.minutes}</td>
              <td className={td}>{s.appearances}</td>
              <td className={td}>{s.goals}</td>
              <td className={td}>{s.assists}</td>
              <td className={td}>{dec(s.pointsPer90, 1)}</td>
              <td className={`${td} pr-0`}>{dec(s.xgi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
