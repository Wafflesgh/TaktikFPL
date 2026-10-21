import Link from "next/link";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { FdrChip, Panel, TeamBadge, TeamLink } from "@/components/ui";
import type { Json } from "@/lib/database.types";
import type { FixtureChange, GameweekInfo, GwFixture } from "@/lib/data/jadwal";
import { formatDayWIB, formatTimeWIB, formatWIB } from "@/lib/time";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "terjadwal",
  tbc: "TBC",
  live: "LIVE",
  ht: "HT",
  finished: "FT",
  postponed: "Ditunda",
  cancelled: "Dibatalkan",
  abandoned: "Dihentikan",
};

// Laga yang tidak dimainkan pada jadwalnya: jam dicoret + label status.
const OFF = new Set(["postponed", "cancelled", "abandoned"]);

function field(v: Json | null, key: string): string | number | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const x = v[key];
    return typeof x === "string" || typeof x === "number" ? x : null;
  }
  return null;
}

const shortWIB = (iso: string | number | null) => (typeof iso === "string" ? `${formatDayWIB(iso)} ${formatTimeWIB(iso)}` : "TBC");
const gwLabel = (gw: string | number | null) => (gw == null ? "tanpa GW" : `GW${gw}`);

/** Kalimat singkat perubahan jadwal dari baris fixture_changes (format worker sync_fixtures). */
export function describeChange(c: FixtureChange): string {
  switch (c.type) {
    case "kickoff_moved":
      return `${shortWIB(field(c.oldValue, "kickoff_utc"))} → ${shortWIB(field(c.newValue, "kickoff_utc"))}`;
    case "gameweek_moved":
    case "rescheduled":
    case "postponed":
      return `${gwLabel(field(c.oldValue, "gw"))} → ${gwLabel(field(c.newValue, "gw"))}`;
    case "status_changed": {
      const s = (v: Json | null) => {
        const raw = field(v, "status");
        return raw == null ? "?" : (STATUS_LABEL[String(raw)] ?? String(raw));
      };
      return `status ${s(c.oldValue)} → ${s(c.newValue)}`;
    }
    case "created":
      return "new fixture added";
    default:
      return c.type;
  }
}

function Center({ f }: { f: GwFixture }) {
  const hasScore = f.homeGoals != null && f.awayGoals != null;
  if ((f.status === "finished" || f.status === "live" || f.status === "ht") && hasScore) {
    const live = f.status !== "finished";
    return (
      <div className="text-center">
        <p className="font-display text-2xl leading-none tabular-nums">
          {f.homeGoals} - {f.awayGoals}
        </p>
        <p className={`mt-1 text-[10px] font-semibold ${live ? "text-red-300" : "text-[var(--text-muted)]"}`}>{STATUS_LABEL[f.status]}</p>
      </div>
    );
  }
  const off = OFF.has(f.status) ? STATUS_LABEL[f.status] : null;
  return (
    <div className="text-center">
      <p className={`text-sm font-semibold tabular-nums ${off ? "text-[var(--text-muted)] line-through" : ""}`}>{formatTimeWIB(f.kickoffUtc)}</p>
      {off && <p className="mt-0.5 text-[10px] font-semibold text-amber-300">{off}</p>}
    </div>
  );
}

type Props = {
  fixtures: GwFixture[];
  gameweeks: GameweekInfo[];
  selectedGw: number | null;
  hrefFor: (patch: Record<string, string | undefined>) => string;
};

/** Daftar laga satu GW dikelompokkan per hari WIB (BLUEPRINT 11.5 D). */
export function GwFixtures({ fixtures, gameweeks, selectedGw, hrefFor }: Props) {
  const idx = gameweeks.findIndex((g) => g.number === selectedGw);
  const gw = gameweeks[idx] ?? null;
  const prev = gameweeks[idx - 1];
  const next = idx >= 0 ? gameweeks[idx + 1] : undefined;
  // Jendela 7 GW di sekitar GW terpilih untuk strip pill.
  const start = Math.max(0, Math.min(idx - 3, gameweeks.length - 7));
  const strip = gameweeks.slice(start, start + 7);
  const center = Math.max(idx, 0);

  const byDay = new Map<string, GwFixture[]>();
  for (const f of fixtures) {
    const key = f.kickoffUtc ? formatDayWIB(f.kickoffUtc) : "Not scheduled";
    byDay.set(key, [...(byDay.get(key) ?? []), f]);
  }
  const changed = fixtures.filter((f) => f.change).length;

  const arrow = "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--glass-border)] bg-white/5";
  return (
    <Panel
      title={gw ? `GW${gw.number} Fixtures` : "Fixtures"}
      subtitle={gw ? `Deadline ${formatWIB(gw.deadlineUtc)} · kick-off times in WIB` : "Gameweek data not available yet"}
      action={
        changed > 0 ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-400/15 px-3 py-1 text-xs text-amber-300">
            <AlertIcon size={14} /> {changed} changed
          </span>
        ) : undefined
      }
    >
      {gameweeks.length > 0 && (
        <nav aria-label="Pilih gameweek" className="mb-5 flex items-center gap-2">
          {prev ? (
            <Link href={hrefFor({ gw: String(prev.number) })} scroll={false} className={`${arrow} hover:bg-white/10`} title={`GW${prev.number}`}>
              <ChevronLeftIcon size={18} />
              <span className="sr-only">GW sebelumnya</span>
            </Link>
          ) : (
            <span className={`${arrow} opacity-40`} aria-hidden="true">
              <ChevronLeftIcon size={18} />
            </span>
          )}
          <div className="flex min-w-0 flex-1 justify-around gap-1 sm:justify-between">
            {strip.map((g, i) => {
              const active = g.number === selectedGw;
              // Layar sempit: hanya GW terpilih ±1.
              const far = Math.abs(start + i - center) > 1;
              return (
                <Link
                  key={g.number}
                  href={hrefFor({ gw: String(g.number) })}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`${far ? "hidden sm:flex" : "flex"} min-w-11 flex-col items-center rounded-full px-2 py-1.5 text-xs ${
                    active ? "bg-[var(--accent)] font-semibold text-white" : "text-[var(--text-muted)] hover:bg-white/10"
                  }`}
                >
                  <span className="text-[10px] opacity-75">GW</span>
                  <span className="text-sm tabular-nums">{g.number}</span>
                  {g.isNext && !active && <span className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent)]" title="GW berikutnya" />}
                </Link>
              );
            })}
          </div>
          {next ? (
            <Link href={hrefFor({ gw: String(next.number) })} scroll={false} className={`${arrow} hover:bg-white/10`} title={`GW${next.number}`}>
              <ChevronRightIcon size={18} />
              <span className="sr-only">GW berikutnya</span>
            </Link>
          ) : (
            <span className={`${arrow} opacity-40`} aria-hidden="true">
              <ChevronRightIcon size={18} />
            </span>
          )}
        </nav>
      )}

      {fixtures.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No fixtures for this GW yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">{day}</h3>
              <ul className="flex flex-col gap-2">
                {list.map((f) => (
                  <li
                    key={f.id}
                    className={`rounded-2xl border bg-white/[0.04] p-3 ${f.change ? "border-amber-400/50" : "border-[var(--glass-border)]"}`}
                  >
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="hidden sm:block">
                          <TeamBadge url={f.home?.badge ?? null} short={f.home?.short ?? null} size={32} />
                        </span>
                        <TeamLink team={f.home} className="truncate font-semibold">
                          <span title={f.home?.name}>{f.home?.short}</span>
                        </TeamLink>
                        <FdrChip value={f.fdrHome} />
                      </div>
                      <Center f={f} />
                      <div className="flex min-w-0 items-center justify-end gap-2">
                        <FdrChip value={f.fdrAway} />
                        <TeamLink team={f.away} className="truncate font-semibold">
                          <span title={f.away?.name}>{f.away?.short}</span>
                        </TeamLink>
                        <span className="hidden sm:block">
                          <TeamBadge url={f.away?.badge ?? null} short={f.away?.short ?? null} size={32} />
                        </span>
                      </div>
                    </div>
                    {f.change && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" title={`Terdeteksi ${formatWIB(f.change.detectedAt)}`}>
                        <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-300">
                          <AlertIcon size={12} /> Schedule changed
                        </span>
                        <span className="text-[var(--text-muted)]">{describeChange(f.change)}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
