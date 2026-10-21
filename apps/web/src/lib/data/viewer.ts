import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { DEFAULT_RISK, DEFAULT_THEME, parseRiskProfile, parseTheme, type RiskProfile, type Theme } from "@/lib/preferences";

/** Cookie preferensi (aplikasi tanpa login — preferensi tersimpan di browser). */
export const PREF_COOKIES = { name: "tfpl_name", theme: "tfpl_theme", risk: "tfpl_risk" } as const;
export const PREF_MAX_AGE = 60 * 60 * 24 * 400; // ±13 bulan (batas maksimum browser)

export type Viewer = {
  displayName: string;
  /** Nama yang disimpan di cookie (null = belum diisi). */
  savedDisplayName: string | null;
  /** Aplikasi pribadi tanpa login: halaman admin selalu terlihat. */
  isAdmin: boolean;
  theme: Theme;
  riskProfile: RiskProfile;
};

/** Preferensi pengunjung dari cookie untuk top bar, tema di root layout, dan /pengaturan. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const jar = await cookies();
  const saved = jar.get(PREF_COOKIES.name)?.value?.trim() || null;
  return {
    displayName: saved ?? "Manager",
    savedDisplayName: saved,
    isAdmin: true,
    theme: parseTheme(jar.get(PREF_COOKIES.theme)?.value) ?? DEFAULT_THEME,
    riskProfile: parseRiskProfile(jar.get(PREF_COOKIES.risk)?.value) ?? DEFAULT_RISK,
  };
});
