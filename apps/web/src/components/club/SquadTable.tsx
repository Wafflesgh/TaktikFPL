"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import type { SquadStat } from "@/lib/data/squad";

type Key = "position" | "priceTenths" | "apps" | "minutes" | "goals" | "assists" | "xg" | "xa" | "cleanSheets" | "saves" | "defcon" | "yellow" | "red" | "bonus" | "points" | "ppm" | "ownedPct";

const POS_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };
const ppm = (p: SquadStat) => (p.apps ? p.points / p.apps : 0);
const value = (p: SquadStat, k: Key): number => (k === "ppm" ? ppm(p) : k === "position" ? -(POS_ORDER[p.position ?? ""] ?? 9) : (p[k] ?? -1));

const COLS: { key: Key; label: string; title: string; fmt: (p: SquadStat) => string }[] = [
  { key: "priceTenths", label: "£", title: "Price", fmt: (p) => (p.priceTenths != null ? (p.priceTenths / 10).toFixed(1) : "-") },
  { key: "apps", label: "Apps", title: "Appearances (starts ≥60 min in brackets)", fmt: (p) => `${p.apps} (${p.starts})` },
  { key: "minutes", label: "Min", title: "Minutes", fmt: (p) => String(p.minutes) },
  { key: "goals", label: "G", title: "Goals", fmt: (p) => String(p.goals) },
  { key: "assists", label: "A", title: "Assists", fmt: (p) => String(p.assists) },
  { key: "xg", label: "xG", title: "Expected goals", fmt: (p) => p.xg.toFixed(1) },
  { key: "xa", label: "xA", title: "Expected assists", fmt: (p) => p.xa.toFixed(1) },
  { key: "cleanSheets", label: "CS", title: "Clean sheets", fmt: (p) => String(p.cleanSheets) },
  { key: "saves", label: "Sv", title: "Saves", fmt: (p) => String(p.saves) },
  { key: "defcon", label: "DC", title: "Defensive contributions", fmt: (p) => String(p.defcon) },
  { key: "yellow", label: "YC", title: "Yellow cards", fmt: (p) => String(p.yellow) },
  { key: "red", label: "RC", title: "Red cards", fmt: (p) => String(p.red) },
  { key: "bonus", label: "Bon", title: "Bonus points", fmt: (p) => String(p.bonus) },
  { key: "points", label: "Pts", title: "FPL points this season", fmt: (p) => String(p.points) },
  { key: "ppm", label: "Pts/m", title: "FPL points per appearance", fmt: (p) => (p.apps ? ppm(p).toFixed(1) : "-") },
  { key: "ownedPct", label: "Own%", title: "Selected by % of FPL managers", fmt: (p) => (p.ownedPct != null ? p.ownedPct.toFixed(1) : "-") },
];

/** Tabel seluruh skuad klub (total musim). Header bisa diurutkan; klik baris → profil pemain. */
export function SquadTable({ players }: { players: SquadStat[] }) {
  const router = useRouter();
  const [sort, setSort] = useState<Key>("position");
  const [desc, setDesc] = useState(true);
  const [pos, setPos] = useState<string | null>(null);

  const rows = players
    .filter((p) => !pos || p.position === pos)
    .sort((a, b) => (value(b, sort) - value(a, sort)) * (desc ? 1 : -1) || b.points - a.points || b.minutes - a.minutes);
  const pick = (k: Key) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(true);
    }
  };
  const arrow = (k: Key) => (k === sort ? (desc ? " ↓" : " ↑") : "");

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        {[null, "GKP", "DEF", "MID", "FWD"].map((p) => (
          <button
            key={p ?? "all"}
            type="button"
            onClick={() => setPos(p)}
            className={`rounded-full px-3 py-1 ${pos === p ? "bg-[var(--accent)] text-white" : "bg-white/5 hover:bg-white/10"}`}
          >
            {p ?? "All"} <span className="opacity-70">{p ? players.filter((x) => x.position === p).length : players.length}</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="text-xs text-[var(--text-muted)]">
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--bg-elev)] py-1.5 text-left font-normal">
                <button type="button" onClick={() => pick("position")} className="hover:text-[var(--text)]">
                  Player{arrow("position")}
                </button>
              </th>
              <th className="text-left font-normal">Form</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-1.5 text-right font-normal" title={c.title}>
                  <button type="button" onClick={() => pick(c.key)} className={`hover:text-[var(--text)] ${sort === c.key ? "text-[var(--text)]" : ""}`}>
                    {c.label}
                    {arrow(c.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                onClick={() => router.push(`/pemain/${p.id}`)}
                className={`cursor-pointer border-t border-white/5 hover:bg-white/[0.06] ${p.apps === 0 ? "text-[var(--text-muted)]" : ""}`}
              >
                <td className="sticky left-0 z-10 bg-[var(--bg-elev)] py-1.5 pr-3">
                  <div className="flex items-center gap-2.5">
                    <PlayerHeadshot name={p.webName} urls={p.photos} size="sm" status={p.status} />
                    <div className="min-w-0">
                      <Link href={`/pemain/${p.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[160px] truncate font-medium hover:text-[var(--accent)]">
                        {p.webName}
                      </Link>
                      <p className="max-w-[160px] truncate text-[11px] text-[var(--text-muted)]" title={p.news ?? undefined}>
                        {p.position ?? "-"}
                        {p.news ? <span className="text-amber-300"> · {p.news}</span> : null}
                      </p>
                    </div>
                  </div>
                </td>
                <td>{p.formLabel ? <FormBadge label={p.formLabel} /> : <span className="text-[var(--text-muted)]">-</span>}</td>
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={`px-1.5 text-right tabular-nums ${sort === c.key ? "font-semibold text-[var(--text)]" : ""} ${
                      c.key === "yellow" && p.yellow > 0 ? "text-amber-300" : c.key === "red" && p.red > 0 ? "text-[var(--status-out)]" : ""
                    }`}
                  >
                    {c.fmt(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        Season totals from official FPL match data (includes matches for a previous club this season). Click a column to sort, a row to open the player profile.
      </p>
    </div>
  );
}
