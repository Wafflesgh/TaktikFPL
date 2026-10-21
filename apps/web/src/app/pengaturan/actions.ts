"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cookies } from "next/headers";
import { PREF_COOKIES, PREF_MAX_AGE } from "@/lib/data/viewer";
import { DISPLAY_NAME_MAX, RISK_OPTIONS, THEME_OPTIONS, type RiskProfile, type Theme } from "@/lib/preferences";

export type SettingsValues = { displayName: string; theme: Theme; riskProfile: RiskProfile };
export type SettingsState = { status: "idle" | "success" | "error"; message: string; values: SettingsValues };

const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(DISPLAY_NAME_MAX, `Display name must be at most ${DISPLAY_NAME_MAX} characters.`),
  theme: z.enum(THEME_OPTIONS.map((o) => o.value) as [Theme, ...Theme[]], "Unknown theme."),
  riskProfile: z.enum(RISK_OPTIONS.map((o) => o.value) as [RiskProfile, ...RiskProfile[]], "Unknown risk profile."),
});

/** Simpan preferensi ke cookie browser (aplikasi tanpa login). */
export async function saveSettings(prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const raw = {
    displayName: String(formData.get("displayName") ?? ""),
    theme: formData.get("theme"),
    riskProfile: formData.get("riskProfile"),
  };
  // Nilai yang dikirim dikembalikan agar form tidak kembali ke nilai lama saat gagal.
  const submitted: SettingsValues = {
    displayName: raw.displayName,
    theme: THEME_OPTIONS.find((o) => o.value === raw.theme)?.value ?? prev.values.theme,
    riskProfile: RISK_OPTIONS.find((o) => o.value === raw.riskProfile)?.value ?? prev.values.riskProfile,
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid data.", values: submitted };
  }

  const { displayName, theme, riskProfile } = parsed.data;
  const jar = await cookies();
  const opts = { maxAge: PREF_MAX_AGE, path: "/", sameSite: "lax" as const, httpOnly: true, secure: true };
  jar.set(PREF_COOKIES.name, displayName, opts);
  jar.set(PREF_COOKIES.theme, theme, opts);
  jar.set(PREF_COOKIES.risk, riskProfile, opts);

  // Tema & nama dipakai di root layout dan top bar semua halaman.
  revalidatePath("/", "layout");
  return { status: "success", message: "Settings saved.", values: parsed.data };
}
