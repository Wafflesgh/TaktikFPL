import type { Metadata } from "next";
import { ModelLabView } from "@/components/model/ModelLabView";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { getLabData } from "@/lib/data/models";
import { getViewer } from "@/lib/data/viewer";

export const metadata: Metadata = { title: "Model Lab · TaktikFPL" };

export default async function ModelPage({ searchParams }: PageProps<"/model">) {
  const params = await searchParams;
  const season = Array.isArray(params.season) ? params.season[0] : (params.season ?? null);
  const [viewer, data] = await Promise.all([getViewer(), getLabData()]);
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={viewer.displayName} isAdmin={viewer.isAdmin} liveCount={0} />
      <ModelLabView data={data} season={season} />
      <BottomNav />
    </div>
  );
}
