"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import type { Peer } from "@/lib/data/playerDetail";

type Col = {
  key: string;
  label: string;
  title: string;
  value: (p: Peer) => number | null;
  fmt: (v: number) => string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const COLS: Col[] = [
  { key: "price", label: "£", title: "Price", value: (p) => (p.priceTenths != null ? p.priceTenths / 10 : null), fmt: (v) => v.toFixed(1) },
  { key: "form", label: "Form", title: "Form score: last-4 percentile within position", value: (p) => p.formScore, fmt: pct },
  { key: "l4", label: "L4 pts/m", title: "Points per match, last 4", value: (p) => p.last4Ppm, fmt: (v) => v.toFixed(1) },
  { key: "pts", label: "Pts", title: "Season points", value: (p) => p.season?.points ?? null, fmt: (v) => String(v) },
  { key: "ppm", label: "Pts/m", title: "Season points per match", value: (p) => p.season?.pointsPerMatch ?? null, fmt: (v) => v.toFixed(1) },
  { key: "mins", label: "Mins", title: "Season minutes", value: (p) => p.season?.minutes ?? null, fmt: (v) => v.toLocaleString("en-GB") },
  { key: "g", label: "G", title: "Goals", value: (p) => p.season?.goals ?? null, fmt: (v) => String(v) },
  { key: "a", label: "A", title: "Assists", value: (p) => p.season?.assists ?? null, fmt: (v) => String(v) },
  { key: "xgi", label: "xGI/90", title: "Expected goal involvements per 90 (season)", value: (p) => p.season?.xgi90 ?? null, fmt: (v) => v.toFixed(2) },
  { key: "cs", label: "CS", title: "Clean sheets", value: (p) => p.season?.cleanSheets ?? null, fmt: (v) => String(v) },
  { key: "dc", label: "DC/90", title: "Defensive contributions per 90", value: (p) => p.season?.defcon90 ?? null, fmt: (v) => v.toFixed(1) },
  { key: "share", label: "Mins %", title: "Share of available minutes, last 4", value: (p) => p.minutesShare, fmt: pct },
  { key: "own", label: "Own", title: "Selected by", value: (p) => p.ownedPct, fmt: (v) => `${v.toFixed(1)}%` },
];

const TOP = 20;

/** Pemain di posisi FPL yang sama: bisa diurutkan per kolom; pemain yang dibuka disorot. */
export function PeerTable({ peers, playerId, position }: { peers: Peer[]; playerId: number; position: string }) {
  const [sortKey, setSortKey] = useState("pts");
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey) ?? COLS[3];
    return [...peers].sort((a, b) => (col.value(b) ?? -Infinity) - (col.value(a) ?? -Infinity));
  }, [peers, sortKey]);
  const rank = sorted.findIndex((p) => p.id === playerId);
  const shown = all ? sorted : sorted.filter((p, i) => i < TOP || p.id === playerId);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="text-xs text-[var(--text-muted)]">
            <tr>
              <th className="py-1 text-left">#</th>
              <th className="text-left">Player</th>
              {COLS.map((c) => (
                <th key={c.key} className="text-right" title={c.title}>
                  <button
                    onClick={() => setSortKey(c.key)}
                    className={`hover:text-[var(--text)] ${sortKey === c.key ? "font-semibold text-[var(--accent)]" : ""}`}
                  >
                    {c.label}
                    {sortKey === c.key ? " ↓" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const i = sorted.indexOf(p);
              const me = p.id === playerId;
              return (
                <tr key={p.id} className={`border-t border-white/5 ${me ? "bg-[var(--accent-soft)]" : ""}`}>
                  <td className="py-1.5 text-xs text-[var(--text-muted)] tabular-nums">{i + 1}</td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <PlayerHeadshot name={p.webName} urls={p.photos} size="sm" status={p.status} />
                      <div className="min-w-0">
                        <Link href={`/pemain/${p.id}`} className="block truncate font-medium hover:text-[var(--accent)] hover:underline">
                          {p.webName}
                        </Link>
                        <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                          {p.team?.short ?? "-"} <FormBadge label={p.formLabel} />
                        </span>
                      </div>
                    </div>
                  </td>
                  {COLS.map((c) => {
                    const v = c.value(p);
                    return (
                      <td key={c.key} className={`text-right tabular-nums ${sortKey === c.key ? "font-semibold" : ""}`}>
                        {v == null ? "-" : c.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>
          {peers.length} {position}s this season{rank >= 0 ? ` · this player ranks #${rank + 1} by the sorted column` : ""}. Click a
          header to sort.
        </span>
        {peers.length > TOP && (
          <button onClick={() => setAll((v) => !v)} className="rounded-full bg-white/5 px-3 py-1 hover:bg-white/10">
            {all ? `Show top ${TOP}` : `Show all ${peers.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
