// Label form dari worker (services/worker/app/features/form.py) → tampilan UI.
export const FORM_LABELS: Record<string, { text: string; className: string }> = {
  panas: { text: "Panas", className: "bg-red-500/20 text-red-300 ring-red-400/40" },
  bagus: { text: "Bagus", className: "bg-green-500/15 text-green-300 ring-green-400/40" },
  stabil: { text: "Stabil", className: "bg-white/10 text-[var(--text)] ring-white/20" },
  menurun: { text: "Menurun", className: "bg-amber-500/15 text-amber-300 ring-amber-400/40" },
  dingin: { text: "Dingin", className: "bg-sky-500/15 text-sky-300 ring-sky-400/40" },
  minim_menit: { text: "Minim menit", className: "bg-white/5 text-[var(--text-muted)] ring-white/10" },
};

export const FORM_ORDER = ["panas", "bagus", "stabil", "menurun", "dingin", "minim_menit"];
