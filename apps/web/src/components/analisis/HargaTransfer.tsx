import Link from "next/link";
import { MarketList } from "@/components/analisis/MarketList";
import { POSITIONS } from "@/components/dashboard/Players";
import { Panel } from "@/components/ui";
import { TREND_LIMIT, type AnalisisData, type PriceMove, type TransferTrend } from "@/lib/data/analisis";
import { formatPrice, formatSnapshotDay } from "@/lib/time";

const NOT_ENOUGH = "Not enough price data yet — needs at least 2 snapshot days";

const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("id-ID");
const signedTenths = (d: number) => `${d > 0 ? "+" : "−"}${(Math.abs(d) / 10).toFixed(1)}`;

function PriceValue({ p }: { p: PriceMove }) {
  return (
    <>
      <p className={`text-sm font-semibold ${p.deltaTenths > 0 ? "text-green-300" : "text-red-300"}`}>{signedTenths(p.deltaTenths)}</p>
      <p className="text-xs text-[var(--text-muted)]">
        {formatPrice(p.oldTenths)} → <span className="text-[var(--text)]">{formatPrice(p.priceTenths)}</span>
      </p>
    </>
  );
}

function NetValue({ t }: { t: TransferTrend }) {
  return (
    <span title={`In ${full.format(t.transfersIn)} · out ${full.format(t.transfersOut)} · net ${full.format(t.net)}`}>
      <p className={`text-sm font-semibold ${t.net > 0 ? "text-green-300" : "text-red-300"}`}>
        {t.net > 0 ? "+" : "−"}
        {compact.format(Math.abs(t.net))}
      </p>
      <p className="text-xs text-[var(--text-muted)]">{formatPrice(t.priceTenths)}</p>
    </span>
  );
}

/** Perubahan harga antara dua hari snapshot terakhir: naik (kiri) · turun (kanan). */
export function PriceChanges({ data }: { data: AnalisisData }) {
  const { latestDate, previousDate, risers, fallers } = data;
  const ready = latestDate && previousDate;
  return (
    <Panel
      title="Price Changes"
      subtitle={ready ? `${formatSnapshotDay(previousDate)} → ${formatSnapshotDay(latestDate)} · ${risers.length} up, ${fallers.length} down` : "Last two snapshot days"}
    >
      {!ready ? (
        <p className="text-sm text-[var(--text-muted)]">{NOT_ENOUGH}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MarketList title="Risers" players={risers} endDate={latestDate} empty="No price rises." value={(p) => <PriceValue p={p} />} />
          <MarketList title="Fallers" players={fallers} endDate={latestDate} empty="No price falls." value={(p) => <PriceValue p={p} />} />
        </div>
      )}
    </Panel>
  );
}

/** Top net transfer masuk/keluar GW ini dari snapshot terbaru, dengan filter posisi (?pos=). */
export function TransferTrends({ data, pos }: { data: AnalisisData; pos: string | undefined }) {
  const { latestDate, nextGw, transfersIn, transfersOut } = data;
  const chip = (active: boolean) => `rounded-full px-3 py-1.5 ${active ? "bg-[var(--accent)] text-white" : "bg-white/5 hover:bg-white/10"}`;
  const href = (p: string | undefined) => (p ? `/analisis?pos=${p}` : "/analisis");
  const posLabel = pos ? ` ${pos}` : "";
  return (
    <Panel
      title={`Transfer Trends${nextGw ? ` · ahead of GW${nextGw}` : ""}`}
      subtitle={
        latestDate
          ? `Net transfers (in − out) since the last deadline · snapshot ${formatSnapshotDay(latestDate)} · top ${TREND_LIMIT}`
          : "Net transfers since the last deadline"
      }
      action={
        <div className="flex flex-wrap justify-end gap-1 text-xs">
          <Link href={href(undefined)} className={chip(!pos)} aria-current={!pos ? "page" : undefined}>
            Semua
          </Link>
          {POSITIONS.map((p) => (
            <Link key={p} href={href(p)} className={chip(pos === p)} aria-current={pos === p ? "page" : undefined}>
              {p}
            </Link>
          ))}
        </div>
      }
    >
      {!latestDate ? (
        <p className="text-sm text-[var(--text-muted)]">{NOT_ENOUGH}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MarketList
            title="Most bought"
            players={transfersIn}
            endDate={latestDate}
            empty={`No net transfers in yet${posLabel}.`}
            value={(t) => <NetValue t={t} />}
          />
          <MarketList
            title="Most sold"
            players={transfersOut}
            endDate={latestDate}
            empty={`No net transfers out yet${posLabel}.`}
            value={(t) => <NetValue t={t} />}
          />
        </div>
      )}
    </Panel>
  );
}
