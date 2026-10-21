import type { Metadata } from "next";
import { AnalisisView } from "@/components/analisis/AnalisisView";
import { POSITIONS } from "@/components/dashboard/Players";
import { getAccuracy } from "@/lib/data/accuracy";
import { getAnalisisData } from "@/lib/data/analisis";
import { getViewer } from "@/lib/data/viewer";

export const metadata: Metadata = { title: "Analysis · TaktikFPL" };

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Analisis({ searchParams }: PageProps<"/analisis">) {
  const params = await searchParams;
  const pos = POSITIONS.find((p) => p === pick(params.pos));

  const [{ displayName, isAdmin }, data, accuracy] = await Promise.all([getViewer(), getAnalisisData(pos), getAccuracy()]);

  return <AnalisisView displayName={displayName} isAdmin={isAdmin} data={data} pos={pos} accuracy={accuracy} />;
}
