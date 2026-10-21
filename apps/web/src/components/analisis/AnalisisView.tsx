import { PriceChanges, TransferTrends } from "@/components/analisis/HargaTransfer";
import { ModelAccuracy } from "@/components/analisis/ModelAccuracy";
import type { GwAccuracy } from "@/lib/data/accuracy";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import type { AnalisisData } from "@/lib/data/analisis";
import { formatSnapshotDay } from "@/lib/time";

type Props = {
  displayName: string;
  isAdmin: boolean;
  data: AnalisisData;
  pos: string | undefined;
  accuracy: GwAccuracy[];
};

// Bagian hub Analisis; bagian berikutnya ditambahkan di sini.
const SECTIONS = [
  { id: "harga-transfer", label: "Prices & Transfers" },
  { id: "akurasi", label: "Model accuracy" },
] as const;

/** Hub Analisis desktop-first. Bagian pertama: Prices & Transfers (BLUEPRINT fitur #13 Price watch). */
export function AnalisisView({ displayName, isAdmin, data, pos, accuracy }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={displayName} isAdmin={isAdmin} liveCount={data.liveCount} />

      <main className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl uppercase leading-none">Analysis</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Numbers from the worker&apos;s daily snapshots · snapshot days in UTC</p>
          </div>
          <nav aria-label="Bagian analisis" className="flex flex-wrap gap-1 text-xs">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-full bg-white/5 px-3 py-1.5 hover:bg-white/10">
                {s.label}
              </a>
            ))}
          </nav>
        </header>

        <section id="harga-transfer" aria-labelledby="harga-transfer-title" className="flex min-w-0 scroll-mt-4 flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="harga-transfer-title" className="font-display text-2xl uppercase leading-none">
              Prices & Transfers
            </h2>
            {data.latestDate && <p className="text-xs text-[var(--text-muted)]">Latest snapshot {formatSnapshotDay(data.latestDate)}</p>}
          </div>
          <div className="grid grid-cols-1 gap-6">
            <PriceChanges data={data} />
            <TransferTrends data={data} pos={pos} />
          </div>
        </section>

        <section id="akurasi" className="flex min-w-0 scroll-mt-4 flex-col gap-4">
          <h2 className="font-display text-2xl uppercase leading-none">Model accuracy</h2>
          <ModelAccuracy rows={accuracy} />
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
