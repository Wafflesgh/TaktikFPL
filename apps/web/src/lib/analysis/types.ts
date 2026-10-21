/** Alasan analisis: dihitung deterministik dari data (bukan LLM); setiap teks memuat angkanya. */
export type Insight = {
  kind: "Fundamental" | "Technical";
  tone: "good" | "bad" | "neutral";
  text: string;
};

export const fmt1 = (v: number) => v.toFixed(1);
export const fmt2 = (v: number) => v.toFixed(2);
export const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
export const best = (rank: number) => (rank === 1 ? "best" : `${ordinal(rank)} best`);
