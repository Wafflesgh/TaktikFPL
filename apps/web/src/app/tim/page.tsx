import type { Metadata } from "next";
import { TimView, type TimMode } from "@/components/tim/TimView";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { getEntryId, getTimData } from "@/lib/data/tim";
import { getViewer } from "@/lib/data/viewer";

export const metadata: Metadata = { title: "My Team · TaktikFPL" };

export default async function TimPage({ searchParams }: PageProps<"/tim">) {
  const params = await searchParams;
  const entryId = await getEntryId();
  // Default: punya Team ID -> mode tim yang sudah ada; belum -> mode tim baru.
  const mode: TimMode = params.mode === "new" ? "new" : params.mode === "existing" || entryId ? "existing" : "new";
  const ftRaw = Array.isArray(params.ft) ? params.ft[0] : params.ft;
  const ft = ftRaw && Number.isInteger(Number(ftRaw)) ? Math.max(0, Math.min(15, Number(ftRaw))) : null;
  const [viewer, data] = await Promise.all([getViewer(), getTimData(entryId, ft)]);
  return (
    <div className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={viewer.displayName} isAdmin={viewer.isAdmin} liveCount={0} />
      <TimView data={data} entryId={entryId} mode={mode} />
      <BottomNav />
    </div>
  );
}
