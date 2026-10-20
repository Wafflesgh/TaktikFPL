import { FixtureTicker, type TickerSort } from "@/components/jadwal/FixtureTicker";
import { GwFixtures } from "@/components/jadwal/GwFixtures";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import type { JadwalData } from "@/lib/data/jadwal";

type Props = {
  displayName: string;
  isAdmin: boolean;
  data: JadwalData;
  sort: TickerSort;
  /** GW dari URL (bisa kosong → default GW berikutnya). */
  gw: number | undefined;
};

/** Halaman Jadwal desktop-first: ticker FDR 6 GW (kiri) + daftar laga per GW (kanan); mobile bertumpuk. */
export function JadwalView({ displayName, isAdmin, data, sort, gw }: Props) {
  const { gameweeks, tickerGws, ticker, selectedGw, fixtures, liveCount } = data;

  const hrefFor = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { sort: sort === "fdr" ? undefined : sort, gw: gw ? String(gw) : undefined, ...patch };
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) s.set(k, v);
    const qs = s.toString();
    return qs ? `/jadwal?${qs}` : "/jadwal";
  };
  const tickerInfo = tickerGws.map((n) => gameweeks.find((g) => g.number === n)).filter((g) => g != null);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={displayName} isAdmin={isAdmin} liveCount={liveCount} />

      <main className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <FixtureTicker rows={ticker} gws={tickerInfo} sort={sort} selectedGw={selectedGw} hrefFor={hrefFor} />
        </div>
        <div className="min-w-0 xl:col-span-5">
          <GwFixtures fixtures={fixtures} gameweeks={gameweeks} selectedGw={selectedGw} hrefFor={hrefFor} />
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
