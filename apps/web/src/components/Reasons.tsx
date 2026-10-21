import type { Reason } from "@/lib/reco";

const TONE: Record<string, string> = {
  good: "bg-green-500/15 text-green-200",
  warn: "bg-amber-500/15 text-amber-200",
  bad: "bg-red-500/15 text-red-200",
};

/** Alasan pemilihan dari engine worker (form, lawan, menit, cedera) — teks template, bukan LLM. */
export function Reasons({ reasons, max = 4, className = "" }: { reasons?: Reason[]; max?: number; className?: string }) {
  if (!reasons?.length) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`}>
      {reasons.slice(0, max).map((r) => (
        <li key={r.kind + r.text} className={`rounded-full px-2 py-0.5 text-[11px] leading-4 ${TONE[r.tone] ?? TONE.good}`}>
          {r.text}
        </li>
      ))}
    </ul>
  );
}
