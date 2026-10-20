// Preferensi pengguna (kolom public.users yang boleh diubah sendiri lewat RLS) + label UI.
// Dipakai server (viewer, Server Action) dan client (form /pengaturan).
import type { Database } from "@/lib/database.types";

type UserRow = Database["public"]["Tables"]["users"]["Row"];
export type Theme = UserRow["theme"];
export type RiskProfile = UserRow["risk_profile"];

export const DEFAULT_THEME: Theme = "violet";
export const DEFAULT_RISK: RiskProfile = "balanced";
export const DISPLAY_NAME_MAX = 40;

/** Urutan = urutan tampil. Warna pratinjau diambil dari tokens.css lewat data-theme. */
export const THEME_OPTIONS: { value: Theme; label: string; hint: string }[] = [
  { value: "violet", label: "Violet", hint: "Gelap dengan cahaya ungu — default" },
  { value: "ember", label: "Ember", hint: "Gradasi oranye-merah menyala" },
  { value: "pitch", label: "Pitch", hint: "Hijau lapangan dengan aksen biru" },
];

export const RISK_OPTIONS: { value: RiskProfile; label: string; hint: string }[] = [
  { value: "safe", label: "Aman", hint: "Utamakan pemain template & menit terjamin, hindari hit transfer." },
  { value: "balanced", label: "Seimbang", hint: "Campur template dan differential; hit hanya bila jelas menguntungkan." },
  { value: "aggressive", label: "Agresif", hint: "Kejar differential & upside tinggi, siap ambil hit demi naik rank." },
];

export function parseTheme(value: unknown): Theme | null {
  return THEME_OPTIONS.find((o) => o.value === value)?.value ?? null;
}

export function parseRiskProfile(value: unknown): RiskProfile | null {
  return RISK_OPTIONS.find((o) => o.value === value)?.value ?? null;
}
