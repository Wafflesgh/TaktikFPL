import { JadwalView } from "@/components/jadwal/JadwalView";
import { TICKER_SORTS, type TickerSort } from "@/components/jadwal/FixtureTicker";
import { getJadwalData } from "@/lib/data/jadwal";
import { getViewer } from "@/lib/data/viewer";

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Jadwal({ searchParams }: PageProps<"/jadwal">) {
  const params = await searchParams;
  const sort: TickerSort = (Object.keys(TICKER_SORTS) as TickerSort[]).find((s) => s === pick(params.sort)) ?? "fdr";
  const gwParam = Number(pick(params.gw));
  const gw = Number.isInteger(gwParam) && gwParam > 0 ? gwParam : undefined;

  const [{ displayName, isAdmin }, data] = await Promise.all([getViewer(), getJadwalData(gw)]);

  return <JadwalView displayName={displayName} isAdmin={isAdmin} data={data} sort={sort} gw={gw} />;
}
