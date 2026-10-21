import Link from "next/link";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import type { UsualXi } from "@/lib/analysis/xi";
import type { PlayerCard } from "@/lib/data/squad";
import { PITCH_SLOTS, POSITION_NAME } from "@/lib/positions";

const SPREAD = 22; // jarak horizontal (%) antar pemain di slot yang sama (mis. dua DC)

/** XI utama di lapangan (serangan ke atas): lingkaran foto + nama + slot, ukuran sama untuk semua. */
export function XiPitch({ xi, cards }: { xi: UsualXi; cards: Map<number, PlayerCard> }) {
  const bySlot = new Map<string, typeof xi.players>();
  for (const p of xi.players) bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), p]);
  const placed = PITCH_SLOTS.flatMap(({ pos, x, y }) => {
    const ps = bySlot.get(pos) ?? [];
    return ps.map((p, i) => ({ p, x: x + (i - (ps.length - 1) / 2) * SPREAD, y }));
  });
  return (
    <div
      className="relative mx-auto aspect-[68/100] w-full max-w-[380px] overflow-hidden rounded-2xl border border-white/10"
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
      {placed.map(({ p, x, y }) => {
        const c = cards.get(p.playerId);
        return (
          <Link
            key={p.playerId}
            href={`/pemain/${p.playerId}`}
            className="absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center hover:z-10"
            style={{ left: `${Math.min(92, Math.max(8, x))}%`, top: `${y}%` }}
            title={`${c?.webName ?? p.playerId} · ${POSITION_NAME[p.slot] ?? p.slot} · ${p.startsInSlot} starts there (${p.starts} total)`}
          >
            <span className="rounded-full ring-2 ring-white/70">
              <PlayerHeadshot name={c?.webName ?? "?"} urls={c?.photos ?? []} size="sm" status={c?.status ?? null} />
            </span>
            <span className="mt-0.5 max-w-full truncate rounded bg-black/60 px-1 text-[11px] font-medium leading-tight text-white">{c?.webName ?? "?"}</span>
            <span className="text-[9px] leading-tight text-white/80">
              {p.slot} · {p.startsInSlot}/{xi.sample}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
