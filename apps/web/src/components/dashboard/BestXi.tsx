import Link from "next/link";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { Reasons } from "@/components/Reasons";
import { Panel } from "@/components/ui";
import type { BestXi, XiPlayer } from "@/lib/data/bestxi";
import { formatPrice, formatWIB } from "@/lib/time";

function Row({ p, xi, tag }: { p: XiPlayer; xi: BestXi; tag: string }) {
  return (
    <tr className={`border-t border-white/5 align-top ${tag ? "opacity-80" : ""}`}>
      <td className="py-2 text-xs text-[var(--text-muted)]">{tag || p.position}</td>
      <td className="py-2">
        <div className="flex items-center gap-2">
          <PlayerHeadshot name={p.name} urls={p.photos} size="sm" status={p.status} />
          <div className="min-w-0">
            <Link href={`/pemain/${p.id}`} className="font-medium hover:underline">
              {p.name}
              {p.id === xi.captain ? " (C)" : p.id === xi.vice ? " (V)" : ""}
            </Link>
            <p className="text-xs text-[var(--text-muted)]">
              {p.teamShort} · {tag ? `${p.position} · ` : ""}
              {formatPrice(p.priceTenths)}
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
  );
}

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
      subtitle={`${xi.formation} · XI ${xi.xpts.toFixed(1)} xPts (captain not doubled) · ${xi.costTenths != null ? `full 15-man squad £${(xi.costTenths / 10).toFixed(1)}m of £100.0m` : "no budget"} · max 3 per club · updated ${xi.finishedAt ? formatWIB(xi.finishedAt) : "-"}`}
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
              <Row key={p.id} p={p} xi={xi} tag="" />
            ))}
            {xi.bench.length > 0 && (
              <tr>
                <td colSpan={5} className="pt-4 text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  Bench (in FPL order)
                </td>
              </tr>
            )}
            {xi.bench.map((p, i) => (
              <Row key={p.id} p={p} xi={xi} tag={p.position === "GKP" ? "GK" : `${i}`} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
