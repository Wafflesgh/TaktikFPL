import Link from "next/link";
import { FDR_COLOR, Panel, TeamBadge } from "@/components/ui";
import type { GameweekInfo, TickerFixture, TickerRow } from "@/lib/data/jadwal";

export const TICKER_SORTS = { fdr: "FDR termudah", name: "Nama" } as const;
export type TickerSort = keyof typeof TICKER_SORTS;

// FDR 5 (merah tua) terlalu gelap untuk teks hitam.
const FDR_TEXT: Record<number, string> = { 5: "#FFFFFF" };

export function sortTicker(rows: TickerRow[], sort: TickerSort): TickerRow[] {
  return [...rows].sort((a, b) =>
    sort === "name" ? a.team.name.localeCompare(b.team.name) : a.total - b.total || a.team.name.localeCompare(b.team.name),
  );
}

const fmtTotal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function TickerChip({ f }: { f: TickerFixture }) {
  const fdr = f.fdr ?? 3;
  const venue = f.home ? "H" : "A";
  return (
    <span
      className="flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-bold text-black"
      style={{ background: FDR_COLOR[fdr] ?? "var(--fdr-3)", color: FDR_TEXT[fdr] }}
      title={`${f.opponent?.name ?? "?"} (${f.home ? "kandang" : "tandang"}) · FDR ${f.fdr ?? "-"}`}
    >
      {f.opponent?.short ?? "?"}
      <span className="font-medium opacity-75">{venue}</span>
    </span>
  );
}

type Props = {
  rows: TickerRow[];
  gws: GameweekInfo[];
  sort: TickerSort;
  selectedGw: number | null;
  hrefFor: (patch: Record<string, string | undefined>) => string;
};

/** Ticker FDR 6 GW (BLUEPRINT 11.5 D): baris tim, kolom GW; kolom tim menempel saat digulir. */
export function FixtureTicker({ rows, gws, sort, selectedGw, hrefFor }: Props) {
  const sorted = sortTicker(rows, sort);
  const stickyCell = "sticky left-0 z-10 bg-[var(--bg-elev)] shadow-[6px_0_8px_-6px_rgba(0,0,0,0.6)]";
  return (
    <Panel
      title="Fixture Ticker"
      subtitle={gws.length ? `GW${gws[0].number}–GW${gws[gws.length - 1].number} · warna = FDR` : "Belum ada gameweek mendatang"}
      action={
        <div className="flex shrink-0 gap-1 rounded-full bg-white/5 p-1 text-xs" role="group" aria-label="Urutkan tim">
          {(Object.keys(TICKER_SORTS) as TickerSort[]).map((s) => (
            <Link
              key={s}
              href={hrefFor({ sort: s === "fdr" ? undefined : s })}
              scroll={false}
              aria-current={sort === s ? "true" : undefined}
              className={`rounded-full px-3 py-1.5 ${sort === s ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:bg-white/10"}`}
            >
              {TICKER_SORTS[s]}
            </Link>
          ))}
        </div>
      }
    >
      {sorted.length === 0 || gws.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Data tim/gameweek musim ini belum tersedia.</p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <table className="w-full min-w-[620px] border-separate border-spacing-x-0 border-spacing-y-1 text-sm">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr>
                <th scope="col" className={`${stickyCell} w-36 py-1 pr-2 text-left font-medium`}>
                  Tim
                </th>
                {gws.map((g) => (
                  <th key={g.number} scope="col" className="min-w-[76px] px-0.5 font-medium">
                    <Link
                      href={hrefFor({ gw: String(g.number) })}
                      scroll={false}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-white/10 ${g.number === selectedGw ? "bg-[var(--accent-soft)] text-[var(--text)]" : ""}`}
                      title={`Lihat jadwal GW${g.number}`}
                    >
                      GW{g.number}
                      {g.isDouble && <span className="text-[10px] text-emerald-300">DGW</span>}
                      {g.isBlank && <span className="text-[10px] text-amber-300">BGW</span>}
                    </Link>
                  </th>
                ))}
                <th scope="col" className="w-12 pl-2 text-right font-medium" title="Jumlah FDR per GW (double = rata-rata, blank = 5)">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.team.id}>
                  <th scope="row" className={`${stickyCell} py-0.5 pr-2 text-left font-normal`}>
                    <span className="flex items-center gap-2">
                      <span className="w-4 text-right text-xs tabular-nums text-[var(--text-muted)]">{i + 1}</span>
                      <TeamBadge url={r.team.badge} short={r.team.short} size={24} />
                      <span className="font-semibold" title={r.team.name}>
                        {r.team.short}
                      </span>
                    </span>
                  </th>
                  {r.cells.map((cell, col) => (
                    <td key={gws[col]?.number ?? col} className="px-0.5 align-middle">
                      {cell.length === 0 ? (
                        <span className="flex h-7 items-center justify-center rounded-md bg-white/[0.06] text-xs text-[var(--text-muted)]" title="Blank GW — tidak ada laga">
                          –
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {cell.map((f) => (
                            <TickerChip key={f.id} f={f} />
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                  <td className="pl-2 text-right font-semibold tabular-nums">{fmtTotal(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>FDR</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className="grid h-5 w-5 place-items-center rounded font-bold" style={{ background: FDR_COLOR[n], color: FDR_TEXT[n] ?? "#000" }}>
            {n}
          </span>
        ))}
        <span className="ml-2 flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-white/[0.06]" /> blank
        </span>
        <span>· dua chip bertumpuk = double · H/A = kandang/tandang</span>
      </div>
    </Panel>
  );
}
