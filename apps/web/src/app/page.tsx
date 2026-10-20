import { DashboardView } from "@/components/dashboard/DashboardView";
import { POSITIONS, SORTS, type Sort } from "@/components/dashboard/Players";
import { getDashboardData } from "@/lib/data/dashboard";
import { getViewer } from "@/lib/data/viewer";

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const pos = POSITIONS.find((p) => p === pick(params.pos));
  const sort: Sort = (Object.keys(SORTS) as Sort[]).find((s) => s === pick(params.sort)) ?? "form";

  const [{ displayName, isAdmin }, data] = await Promise.all([getViewer(), getDashboardData()]);

  return <DashboardView displayName={displayName} isAdmin={isAdmin} data={data} pos={pos} sort={sort} />;
}
