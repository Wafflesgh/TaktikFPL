"use client";

import Link from "next/link";
import { useState } from "react";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { Reasons } from "@/components/Reasons";
import { XptsBreakdownBody } from "@/components/XptsDetail";
import { Panel } from "@/components/ui";
import type { BestXi, XiPlayer } from "@/lib/data/bestxi";

// Lapangan horizontal: kiper di kiri, penyerang di kanan (x dalam %).
const LINE_X: Record<string, number> = { GKP: 8, DEF: 31, MID: 57, FWD: 83 };

const price = (t: number) => `£${(t / 10).toFixed(1)}m`;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WIB" : "-";

function Card({ p, xi, active, onPick, bench = false }: { p: XiPlayer; xi: BestXi; active: boolean; onPick: () => void; bench?: boolean }) {
  const tag = p.id === xi.captain ? "C" : p.id === xi.vice ? "V" : null;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      aria-label={`${p.name}, ${p.xpts.toFixed(1)} xPts — show details`}
      className={`group flex w-[92px] flex-col items-center text-center ${bench ? "opacity-90" : ""}`}
    >
      <span className="relative">
        <PlayerHeadshot name={p.name} urls={p.photos} size="cut" status={p.status} />
        {tag && (
          <span className="absolute -right-1 top-0 grid h-5 w-5 place-items-center rounded-full bg-black text-[10px] font-bold text-white ring-2 ring-[var(--accent)]">{tag}</span>
        )}
      </span>
      <span
        className={`-mt-1 max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-white ${active ? "bg-[var(--accent)]" : "bg-black/70 group-hover:bg-black/85"}`}
      >
        {p.name}
      </span>
      <span className="text-[10px] leading-tight text-white/85">
        {p.xpts.toFixed(1)} xPts · {p.opponents[0] ?? "-"}
        {p.opponents.length > 1 ? " +" : ""}
      </span>
      <span
        className={`mt-1 grid h-7 w-7 place-items-center rounded-full bg-white/95 p-1 shadow transition ${active ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-black/40" : "group-hover:scale-110"}`}
        title={`${p.teamShort} · click for details`}
      >
        {p.teamBadge ? (
          // eslint-disable-next-line @next/next/no-img-element -- badge dari CDN yang dikonfigurasi
          <img src={p.teamBadge} alt={p.teamShort} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <span className="text-[8px] font-bold text-black">{p.teamShort}</span>
        )}
      </span>
    </button>
  );
}

function Detail({ p, xi }: { p: XiPlayer; xi: BestXi }) {
  const tag = p.id === xi.captain ? " (C)" : p.id === xi.vice ? " (V)" : "";
  const benchIdx = xi.bench.findIndex((b) => b.id === p.id);
  return (
    <div className="mt-4 rounded-2xl border border-[var(--glass-border)] bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <PlayerHeadshot name={p.name} urls={p.photos} size="cut" status={p.status} />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
            {benchIdx >= 0 ? `Bench ${p.position === "GKP" ? "GK" : benchIdx}` : "Starting XI"} · {p.position}
          </p>
          <Link href={`/pemain/${p.id}`} className="text-xl font-semibold hover:text-[var(--accent)] hover:underline">
            {p.name}
            {tag}
          </Link>
          <p className="text-sm text-[var(--text-muted)]">
            {p.teamId != null ? (
              <Link href={`/klub/${p.teamId}`} className="hover:text-[var(--accent)]">
                {p.teamShort}
              </Link>
            ) : (
              p.teamShort
            )}{" "}
            · {price(p.priceTenths)} · GW{xi.gw}: {p.opponents.join(" + ") || "-"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--text-muted)]">xPts GW{xi.gw}</p>
          <p className="font-display text-4xl leading-none">{p.xpts.toFixed(1)}</p>
        </div>
      </div>
      <p className="mb-1 text-xs font-semibold">Why</p>
      <Reasons reasons={p.reasons} max={12} className="mb-3" />
      <XptsBreakdownBody fixtures={p.breakdown} reasons={[]} />
    </div>
  );
}

/** Best XI di lapangan horizontal (GK kiri → penyerang kanan) + bangku; klik pemain → rincian lengkap di bawah. */
export function BestXiPanel({ xi }: { xi: BestXi | null }) {
  const [picked, setPicked] = useState<number | null>(null);
  if (!xi) {
    return (
      <Panel title="Best XI of the week" subtitle="Projected team for the next gameweek">
        <p className="text-sm text-[var(--text-muted)]">Not available yet — the worker builds it with each projection run.</p>
      </Panel>
    );
  }
  const all = [...xi.players, ...xi.bench];
  const sel = all.find((p) => p.id === (picked ?? xi.captain)) ?? xi.players[0];
  const lines = Object.keys(LINE_X).map((pos) => [pos, xi.players.filter((p) => p.position === pos)] as const);

  return (
    <Panel
      title={`Best XI · GW${xi.gw}`}
      subtitle={`${xi.formation} · XI ${xi.xpts.toFixed(1)} xPts (captain not doubled) · ${xi.costTenths != null ? `full 15-man squad £${(xi.costTenths / 10).toFixed(1)}m of £100.0m` : "no budget"} · max 3 per club · updated ${when(xi.finishedAt)}`}
    >
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-[760px] gap-3">
          <div
            className="relative h-[460px] flex-1 overflow-hidden rounded-2xl border border-white/10"
            style={{ background: "repeating-linear-gradient(90deg, #166534 0 10%, #15803d 10% 20%)" }}
          >
            <svg viewBox="0 0 160 90" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
              <g fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.5">
                <rect x="2" y="2" width="156" height="86" />
                <line x1="80" y1="2" x2="80" y2="88" />
                <circle cx="80" cy="45" r="11" />
                <rect x="2" y="22" width="22" height="46" />
                <rect x="2" y="34" width="8" height="22" />
                <rect x="136" y="22" width="22" height="46" />
                <rect x="150" y="34" width="8" height="22" />
              </g>
            </svg>
            {lines.map(([pos, ps]) =>
              ps.map((p, i) => (
                <div
                  key={p.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${LINE_X[pos]}%`, top: `${((i + 1) / (ps.length + 1)) * 100}%` }}
                >
                  <Card p={p} xi={xi} active={sel?.id === p.id} onPick={() => setPicked(p.id)} />
                </div>
              )),
            )}
          </div>
          {xi.bench.length > 0 && (
            <div className="flex w-[120px] shrink-0 flex-col items-center justify-around rounded-2xl border border-white/10 bg-white/[0.04] py-2">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Bench</p>
              {xi.bench.map((p) => (
                <Card key={p.id} p={p} xi={xi} active={sel?.id === p.id} onPick={() => setPicked(p.id)} bench />
              ))}
            </div>
          )}
        </div>
      </div>
      {sel && <Detail p={sel} xi={xi} />}
    </Panel>
  );
}
