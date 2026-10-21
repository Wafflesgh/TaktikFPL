"use client";

import { useMemo, useState } from "react";
import type { PositionSeason, PositionStat } from "@/lib/data/playerDetail";
import { PITCH_SLOTS, POSITION_NAME } from "@/lib/positions";

const ALL = "all";

function merge(seasons: PositionSeason[]): PositionStat[] {
  const out = new Map<string, PositionStat>();
  for (const s of seasons) {
    for (const p of s.positions) {
      const m = out.get(p.pos) ?? { pos: p.pos, apps: 0, minutes: 0, goals: 0, assists: 0, xg: 0, xa: 0 };
      out.set(p.pos, {
        pos: p.pos,
        apps: m.apps + p.apps,
        minutes: m.minutes + p.minutes,
        goals: m.goals + p.goals,
        assists: m.assists + p.assists,
        xg: m.xg + p.xg,
        xa: m.xa + p.xa,
      });
    }
  }
  return [...out.values()].sort((a, b) => b.apps - a.apps);
}

const per90 = (v: number, mins: number) => (mins > 0 ? ((v * 90) / mins).toFixed(2) : "-");

/**
 * Peta posisi ala Football Manager: satu lingkaran per slot posisi yang pernah dimainkan
 * (ukuran = porsi penampilan), slot lain kosong. Klik lingkaran / baris tabel untuk rincian.
 */
export function PositionMap({ seasons, currentLabel }: { seasons: PositionSeason[]; currentLabel: string | null }) {
  const hasCurrent = seasons.some((s) => s.label === currentLabel && s.positions.length > 0);
  const [season, setSeason] = useState<string>(hasCurrent && currentLabel ? currentLabel : ALL);
  const rows = useMemo(
    () => (season === ALL ? merge(seasons) : (seasons.find((s) => s.label === season)?.positions ?? [])),
    [season, seasons],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const total = rows.reduce((a, r) => a + r.apps, 0);
  const byPos = new Map(rows.map((r) => [r.pos, r]));
  const top = rows.find((r) => r.pos !== "Sub")?.pos ?? null;
  const sel = byPos.get(picked ?? "") ?? (top ? byPos.get(top) : undefined);
  const maxShare = Math.max(0.01, ...rows.filter((r) => r.pos !== "Sub").map((r) => r.apps / Math.max(1, total)));
  const sub = byPos.get("Sub");

  if (seasons.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No position data yet. Understat lineups start in 2025/26.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Season">
        {[...seasons.map((s) => s.label), ALL].map((label) => (
          <button
            key={label}
            role="tab"
            aria-selected={season === label}
            onClick={() => {
              setSeason(label);
              setPicked(null);
            }}
            className={`rounded-full px-3 py-1 text-xs ${season === label ? "bg-[var(--accent)] text-white" : "bg-white/5 text-[var(--text-muted)] hover:bg-white/10"}`}
          >
            {label === ALL ? "All seasons" : label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
        {/* Lapangan: serangan ke atas */}
        <div
          className="relative mx-auto aspect-[68/100] w-full max-w-[320px] overflow-hidden rounded-2xl border border-white/10"
          style={{ background: "linear-gradient(180deg, #14532d 0%, #166534 50%, #14532d 100%)" }}
        >
          <svg viewBox="0 0 68 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <g fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.4">
              <rect x="2" y="2" width="64" height="96" />
              <line x1="2" y1="50" x2="66" y2="50" />
              <circle cx="34" cy="50" r="8" />
              <rect x="16" y="2" width="36" height="14" />
              <rect x="25" y="2" width="18" height="5" />
              <rect x="16" y="84" width="36" height="14" />
              <rect x="25" y="93" width="18" height="5" />
            </g>
          </svg>
          {PITCH_SLOTS.map(({ pos, x, y }) => {
            const r = byPos.get(pos);
            if (!r) {
              return (
                <span
                  key={pos}
                  className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/20"
                  style={{ left: `${x}%`, top: `${y}%` }}
                  aria-hidden="true"
                />
              );
            }
            const share = r.apps / Math.max(1, total);
            const size = 30 + 22 * (share / maxShare);
            const active = sel?.pos === pos;
            return (
              <button
                key={pos}
                onClick={() => setPicked(pos)}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${active ? "z-10" : ""}`}
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-label={`${POSITION_NAME[pos] ?? pos}: ${r.apps} apps, ${r.goals} goals, ${r.assists} assists`}
              >
                <span
                  className={`grid place-items-center rounded-full font-semibold text-white shadow-lg ${active ? "ring-2 ring-white" : ""}`}
                  style={{
                    width: size,
                    height: size,
                    background: `color-mix(in srgb, var(--accent) ${Math.round(45 + 55 * (share / maxShare))}%, #0b1f14)`,
                  }}
                >
                  {r.apps}
                </span>
                <span className="mt-0.5 rounded bg-black/50 px-1 text-[10px] leading-tight text-white">{pos}</span>
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {sel && (
            <div className="rounded-2xl border border-[var(--glass-border)] bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{sel.pos}</p>
              <p className="text-lg font-semibold">{POSITION_NAME[sel.pos] ?? sel.pos}</p>
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
                <Stat label="Apps" value={sel.apps} />
                <Stat label="Of total" value={`${Math.round((sel.apps / Math.max(1, total)) * 100)}%`} />
                <Stat label="Minutes" value={sel.minutes.toLocaleString("en-GB")} />
                <Stat label="G / A" value={`${sel.goals} / ${sel.assists}`} />
                <Stat label="xG / xA" value={`${sel.xg.toFixed(1)} / ${sel.xa.toFixed(1)}`} />
                <Stat label="G+A /90" value={per90(sel.goals + sel.assists, sel.minutes)} />
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="py-1 text-left">Position</th>
                  <th className="text-right">Apps</th>
                  <th className="text-right">%</th>
                  <th className="text-right">Mins</th>
                  <th className="text-right">G</th>
                  <th className="text-right">A</th>
                  <th className="text-right">xG</th>
                  <th className="text-right">xA</th>
                  <th className="text-right">G+A/90</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.pos}
                    onClick={() => setPicked(r.pos)}
                    className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${sel?.pos === r.pos ? "bg-[var(--accent-soft)]" : ""}`}
                  >
                    <td className="py-1.5">
                      {POSITION_NAME[r.pos] ?? r.pos} <span className="text-xs text-[var(--text-muted)]">{r.pos}</span>
                    </td>
                    <td className="text-right tabular-nums">{r.apps}</td>
                    <td className="text-right tabular-nums">{Math.round((r.apps / Math.max(1, total)) * 100)}%</td>
                    <td className="text-right tabular-nums">{r.minutes.toLocaleString("en-GB")}</td>
                    <td className="text-right tabular-nums">{r.goals}</td>
                    <td className="text-right tabular-nums">{r.assists}</td>
                    <td className="text-right tabular-nums">{r.xg.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{r.xa.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{per90(r.goals + r.assists, r.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {total} appearances{sub ? `, ${sub.apps} off the bench (position not recorded)` : ""}. Understat records the
            position slot each match, not the tactical role.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
