import { DashboardView } from "@/components/dashboard/DashboardView";
import { POSITIONS, SORTS, type Sort } from "@/components/dashboard/Players";
import { getDashboardData } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const pos = POSITIONS.find((p) => p === pick(params.pos));
  const sort: Sort = (Object.keys(SORTS) as Sort[]).find((s) => s === pick(params.sort)) ?? "form";

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  const [{ data: me }, data] = await Promise.all([
    userId
      ? supabase.from("users").select("display_name, is_admin").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    getDashboardData(),
  ]);
  const displayName = me?.display_name ?? (claims?.claims?.email as string | undefined)?.split("@")[0] ?? "Manajer";

  return <DashboardView displayName={displayName} isAdmin={Boolean(me?.is_admin)} data={data} pos={pos} sort={sort} />;
}
