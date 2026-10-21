import type { Insight } from "@/lib/analysis/types";

const DOT: Record<Insight["tone"], string> = {
  good: "bg-[var(--status-ok)]",
  bad: "bg-[var(--status-out)]",
  neutral: "bg-white/40",
};

/** Daftar alasan dikelompokkan Fundamental / Technical; titik warna = menguntungkan / merugikan. */
export function Insights({ items }: { items: Insight[] }) {
  const groups = (["Fundamental", "Technical"] as const).map((k) => [k, items.filter((i) => i.kind === k)] as const).filter(([, xs]) => xs.length);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map(([kind, xs]) => (
        <div key={kind}>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{kind}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {xs.map((x) => (
              <li key={x.text} className="flex gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[x.tone]}`} aria-hidden="true" />
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const LEVEL_COLOR = ["", "var(--fdr-1)", "var(--fdr-2)", "var(--fdr-3)", "var(--fdr-4)", "var(--fdr-5)"];

/** Chip tingkat kesulitan 1–5 (warna mengikuti skala FDR). */
export function LevelChip({ level, label }: { level: number; label: string }) {
  return (
    <span
      className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-bold text-black"
      style={{ background: LEVEL_COLOR[level] ?? "var(--fdr-3)" }}
      title={`Difficulty ${level}/5`}
    >
      {level} · {label}
    </span>
  );
}
