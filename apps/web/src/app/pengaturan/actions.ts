"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_NAME_MAX, RISK_OPTIONS, THEME_OPTIONS, type RiskProfile, type Theme } from "@/lib/preferences";

export type SettingsValues = { displayName: string; theme: Theme; riskProfile: RiskProfile };
export type SettingsState = { status: "idle" | "success" | "error"; message: string; values: SettingsValues };

const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Nama tampilan wajib diisi.")
    .max(DISPLAY_NAME_MAX, `Nama tampilan maksimal ${DISPLAY_NAME_MAX} karakter.`),
  theme: z.enum(THEME_OPTIONS.map((o) => o.value) as [Theme, ...Theme[]], "Tema tidak dikenal."),
  riskProfile: z.enum(RISK_OPTIONS.map((o) => o.value) as [RiskProfile, ...RiskProfile[]], "Profil risiko tidak dikenal."),
});

/** Simpan preferensi ke public.users milik pengguna login (RLS: hanya baris & kolom preferensi sendiri). */
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
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Data tidak valid.", values: submitted };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return { status: "error", message: "Sesi berakhir. Silakan masuk lagi.", values: submitted };

  const { displayName, theme, riskProfile } = parsed.data;
  const { data, error } = await supabase
    .from("users")
    .update({ display_name: displayName, theme, risk_profile: riskProfile })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { status: "error", message: "Gagal menyimpan pengaturan. Coba lagi sebentar lagi.", values: submitted };
  }

  // Tema & nama dipakai di root layout dan top bar semua halaman.
  revalidatePath("/", "layout");
  return { status: "success", message: "Pengaturan tersimpan.", values: parsed.data };
}
