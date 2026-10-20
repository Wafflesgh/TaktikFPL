import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/analisis/Sparkline";
import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { SPARK_DAYS, type MarketPlayer } from "@/lib/data/analisis";

/** Daftar pemain pasar (harga/transfer): identitas + form · sparkline 14 hari · nilai di kanan. */
export function MarketList<T extends MarketPlayer>({
  title,
  players,
  endDate,
  empty,
  value,
}: {
  title: ReactNode;
  players: T[];
  endDate: string;
  empty: string;
  value: (p: T) => ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {players.length === 0 ? (
        <p className="py-2 text-sm text-[var(--text-muted)]">{empty}</p>
      ) : (
        <ol>
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 border-t border-white/5 py-2 first:border-t-0 sm:gap-3">
              <PlayerHeadshot name={p.webName} urls={p.photos} size="sm" status={p.status} />
              <div className="min-w-0 flex-1">
                <Link href={`/pemain/${p.id}`} className="block truncate text-sm font-medium hover:text-[var(--accent)] hover:underline">
                  {p.webName}
                </Link>
                {/* Badge form turun ke baris sendiri bila sempit (mobile), tanpa overflow. */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">
                    {p.team?.short} · {p.position}
                  </span>
                  <span className="whitespace-nowrap text-xs text-[var(--text-muted)]" title="Kepemilikan">
                    {p.ownedPct ?? 0}%
                  </span>
                  <FormBadge label={p.form?.label} reasons={p.form?.reasons} pointsPerMatch={p.form?.last4Ppm} />
                </div>
              </div>
              <Sparkline points={p.spark} endDate={endDate} days={SPARK_DAYS} />
              <div className="shrink-0 text-right tabular-nums">{value(p)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
