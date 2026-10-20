import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Viewer = { displayName: string; isAdmin: boolean };

/** Nama tampilan & status admin pengguna login untuk top bar. */
export async function getViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  const { data: me } = userId
    ? await supabase.from("users").select("display_name, is_admin").eq("id", userId).maybeSingle()
    : { data: null };
  const displayName = me?.display_name ?? (claims?.claims?.email as string | undefined)?.split("@")[0] ?? "Manajer";
  return { displayName, isAdmin: Boolean(me?.is_admin) };
}
