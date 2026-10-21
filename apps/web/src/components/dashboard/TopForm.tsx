"use client";

import Link from "next/link";
import { useState } from "react";
import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { Panel, ProgressLine } from "@/components/ui";
import type { PlayerRow } from "@/lib/data/dashboard";

const FORM_COLOR: Record<string, string> = {
  panas: "#F87171",
  bagus: "#4ADE80",
  stabil: "var(--accent)",
  menurun: "#FBBF24",
  dingin: "#38BDF8",
};

const FILTERS = [
  { key: "ALL", label: "All" },
  { key: "FWD", label: "FWD" },
  { key: "MID", label: "MID" },
  { key: "DEF", label: "DEF" },
  { key: "GKP", label: "GK" },
] as const;

const TOP = 8;

/** Form teratas semua pemain (sudah urut form) dengan filter posisi; "Show all" membuka daftar penuh. */
export function TopForm({ players }: { players: PlayerRow[] }) {
  const [pos, setPos] = useState<(typeof FILTERS)[number]["key"]>("ALL");
  const [all, setAll] = useState(false);
  const list = pos === "ALL" ? players : players.filter((p) => p.position === pos);
  const shown = all ? list : list.slice(0, TOP);
  return (
    <Panel title="Top Form" subtitle="Form score vs same-position players · last 4 matches">
      <div className="mb-3 flex flex-wrap gap-1 text-xs" role="tablist" aria-label="Position">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={pos === f.key}
            onClick={() => {
              setPos(f.key);
              setAll(false);
            }}
            className={`rounded-full px-2.5 py-1 ${pos === f.key ? "bg-[var(--accent)] text-white" : "bg-white/5 text-[var(--text-muted)] hover:bg-white/10"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ul className={`flex flex-col gap-3 ${all ? "max-h-[640px] overflow-y-auto pr-1" : ""}`}>
        {shown.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3">
            <span className="w-5 text-right text-xs tabular-nums text-[var(--text-muted)]">{i + 1}</span>
            <PlayerHeadshot name={p.webName} urls={p.photos} size="sm" status={p.status} />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/pemain/${p.id}`} className="block truncate font-medium hover:text-[var(--accent)] hover:underline">
                    {p.webName}
                  </Link>
                  <span className="block text-[11px] leading-tight text-[var(--text-muted)]">
                    {p.team?.short} · {p.position}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <FormBadge label={p.form?.label} pointsPerMatch={p.form?.last4Ppm} />
                  <span className="w-9 text-right tabular-nums text-[var(--text-muted)]">{Math.round((p.form?.score ?? 0) * 100)}%</span>
                </span>
              </div>
              <ProgressLine value={p.form?.score ?? 0} color={FORM_COLOR[p.form?.label ?? ""] ?? "var(--accent)"} />
            </div>
          </li>
        ))}
      </ul>
      {list.length > TOP && (
        <button onClick={() => setAll((v) => !v)} className="mt-3 w-full rounded-full bg-white/5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-white/10">
          {all ? `Show top ${TOP}` : `Show all ${list.length}`}
        </button>
      )}
    </Panel>
  );
}
