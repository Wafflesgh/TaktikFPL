import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_RISK, DEFAULT_THEME, parseRiskProfile, parseTheme, type RiskProfile, type Theme } from "@/lib/preferences";

export type Viewer = {
  displayName: string;
  /** users.display_name apa adanya (null = belum diisi; top bar memakai awalan email). */
  savedDisplayName: string | null;
  isAdmin: boolean;
  theme: Theme;
  riskProfile: RiskProfile;
};

/**
 * Pengguna login + preferensinya untuk top bar, tema di root layout, dan /pengaturan.
 * Dibungkus `cache` agar layout & halaman berbagi satu query per request.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  const { data: me } = userId
    ? await supabase.from("users").select("display_name, is_admin, theme, risk_profile").eq("id", userId).maybeSingle()
    : { data: null };
  const displayName = me?.display_name ?? (claims?.claims?.email as string | undefined)?.split("@")[0] ?? "Manajer";
  return {
    displayName,
    savedDisplayName: me?.display_name ?? null,
    isAdmin: Boolean(me?.is_admin),
    theme: parseTheme(me?.theme) ?? DEFAULT_THEME,
    riskProfile: parseRiskProfile(me?.risk_profile) ?? DEFAULT_RISK,
  };
});
