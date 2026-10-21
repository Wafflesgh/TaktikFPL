import { FORM_LABELS } from "@/lib/form";

type Props = {
  label: string | null | undefined;
  reasons?: string[];
  pointsPerMatch?: number | null;
};

/** Badge form pemain (hasil job build_form di worker). */
export function FormBadge({ label, reasons = [], pointsPerMatch }: Props) {
  if (!label) {
    return <span className="text-xs text-[var(--text-muted)]">form: -</span>;
  }
  const meta = FORM_LABELS[label] ?? { text: label, className: "bg-white/10 ring-white/20" };
  const title = [
    pointsPerMatch != null ? `${Number(pointsPerMatch).toFixed(1)} pts/match (last 4)` : null,
    ...reasons,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${meta.className}`}
      title={title || undefined}
    >
      {meta.text}
    </span>
  );
}
