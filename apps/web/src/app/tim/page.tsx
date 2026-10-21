import type { Metadata } from "next";
import { TimView } from "@/components/tim/TimView";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { getEntryId, getTimData } from "@/lib/data/tim";
import { getViewer } from "@/lib/data/viewer";

export const metadata: Metadata = { title: "Tim Saya · TaktikFPL" };

export default async function TimPage() {
  const entryId = await getEntryId();
  const [viewer, data] = await Promise.all([getViewer(), getTimData(entryId)]);
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={viewer.displayName} isAdmin={viewer.isAdmin} liveCount={0} />
      <TimView data={data} entryId={entryId} />
      <BottomNav />
    </div>
  );
}
