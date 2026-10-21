// Label form dari worker (services/worker/app/features/form.py) → tampilan UI.
export const FORM_LABELS: Record<string, { text: string; className: string }> = {
  panas: { text: "Hot", className: "bg-red-500/20 text-red-300 ring-red-400/40" },
  bagus: { text: "Good", className: "bg-green-500/15 text-green-300 ring-green-400/40" },
  stabil: { text: "Steady", className: "bg-white/10 text-[var(--text)] ring-white/20" },
  menurun: { text: "Declining", className: "bg-amber-500/15 text-amber-300 ring-amber-400/40" },
  dingin: { text: "Cold", className: "bg-sky-500/15 text-sky-300 ring-sky-400/40" },
  minim_menit: { text: "Low minutes", className: "bg-white/5 text-[var(--text-muted)] ring-white/10" },
};

export const FORM_ORDER = ["panas", "bagus", "stabil", "menurun", "dingin", "minim_menit"];

/** Label form dari worker (kunci internal) → teks UI English, huruf kecil untuk kalimat. */
export const formText = (label: string | null | undefined): string | null => (label ? (FORM_LABELS[label]?.text ?? label).toLowerCase() : null);
