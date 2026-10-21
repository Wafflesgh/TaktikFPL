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
  { value: "violet", label: "Violet", hint: "Dark with a purple glow — default" },
  { value: "ember", label: "Ember", hint: "Blazing orange-red gradient" },
  { value: "pitch", label: "Pitch", hint: "Pitch green with blue accents" },
];

export const RISK_OPTIONS: { value: RiskProfile; label: string; hint: string }[] = [
  { value: "safe", label: "Safe", hint: "Favour template players & nailed minutes, avoid transfer hits." },
  { value: "balanced", label: "Balanced", hint: "Mix template and differentials; take hits only when clearly worth it." },
  { value: "aggressive", label: "Aggressive", hint: "Chase differentials & high upside, ready to take hits to climb." },
];

export function parseTheme(value: unknown): Theme | null {
  return THEME_OPTIONS.find((o) => o.value === value)?.value ?? null;
}

export function parseRiskProfile(value: unknown): RiskProfile | null {
  return RISK_OPTIONS.find((o) => o.value === value)?.value ?? null;
}
