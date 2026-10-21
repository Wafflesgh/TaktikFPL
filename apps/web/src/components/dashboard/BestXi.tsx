import Link from "next/link";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { Reasons } from "@/components/Reasons";
import { Panel } from "@/components/ui";
import type { BestXi } from "@/lib/data/bestxi";
import { formatPrice, formatWIB } from "@/lib/time";

/** "Team of the week": XI dengan xPts tertinggi untuk GW berikutnya, plus alasan tiap pilihan. */
export function BestXiPanel({ xi }: { xi: BestXi | null }) {
  if (!xi) {
    return (
      <Panel title="Best XI of the week" subtitle="Projected team for the next gameweek">
        <p className="text-sm text-[var(--text-muted)]">Not available yet — the worker builds it with each projection run.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title={`Best XI · GW${xi.gw}`}
      subtitle={`${xi.formation} · ${xi.xpts.toFixed(1)} xPts (captain not doubled) · max 3 per club, no budget · updated ${xi.finishedAt ? formatWIB(xi.finishedAt) : "-"}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-[var(--text-muted)]">
            <tr>
              <th className="py-1 text-left">Pos</th>
              <th className="text-left">Player</th>
              <th className="text-left">GW{xi.gw}</th>
              <th className="text-right">xPts</th>
              <th className="pl-4 text-left">Why</th>
            </tr>
          </thead>
          <tbody>
            {xi.players.map((p) => (
              <tr key={p.id} className="border-t border-white/5 align-top">
                <td className="py-2 text-xs text-[var(--text-muted)]">{p.position}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <PlayerHeadshot name={p.name} urls={p.photos} size="sm" status={p.status} />
                    <div className="min-w-0">
                      <Link href={`/pemain/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                        {p.id === xi.captain ? " (C)" : p.id === xi.vice ? " (V)" : ""}
                      </Link>
                      <p className="text-xs text-[var(--text-muted)]">
                        {p.teamShort} · {formatPrice(p.priceTenths)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap py-2 text-xs">{p.opponents.join(" + ") || "-"}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{p.xpts.toFixed(1)}</td>
                <td className="py-2 pl-4">
                  <Reasons reasons={p.reasons} max={3} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
