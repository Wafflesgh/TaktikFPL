import Link from "next/link";
import type { ReactNode } from "react";

/** Panel kaca dengan judul (ref-02). */
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-semibold leading-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Kartu statistik kecil (ref-02: Matches / Goals / Upsets / Pressing). */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-white/[0.04] p-3">
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{label}</span>
        {icon && <span className={tone === "warn" ? "text-amber-300" : ""}>{icon}</span>}
      </div>
      <p className={`mt-2 font-display text-3xl leading-none ${tone === "warn" ? "text-amber-300" : ""}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

/** Garis progres dengan titik (ref-02 panel AI Prediction). value 0..1 */
export function ProgressLine({ value, color = "var(--accent)" }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-white/10" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--bg)]"
        style={{ left: `${pct}%`, background: color }}
      />
    </div>
  );
}

/** Nama klub yang bisa diklik → profil klub. */
export function TeamLink({ team, children, className = "" }: { team: { id: number } | null | undefined; children: ReactNode; className?: string }) {
  if (!team) return <span className={className}>{children}</span>;
  return (
    <Link href={`/klub/${team.id}`} className={`hover:text-[var(--accent)] hover:underline ${className}`}>
      {children}
    </Link>
  );
}

/** Badge klub dari CDN (URL di-resolve server); fallback singkatan 3 huruf. */
export function TeamBadge({ url, short, size = 40 }: { url: string | null; short: string | null; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/90 p-1.5"
      style={{ width: size, height: size }}
      title={short ?? undefined}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- badge dari CDN yang dikonfigurasi
        <img src={url} alt={short ?? "badge"} className="h-full w-full object-contain" loading="lazy" />
      ) : (
        <span className="text-xs font-bold text-black">{short}</span>
      )}
    </span>
  );
}

export const FDR_COLOR: Record<number, string> = {
  1: "var(--fdr-1)",
  2: "var(--fdr-2)",
  3: "var(--fdr-3)",
  4: "var(--fdr-4)",
  5: "var(--fdr-5)",
};

export function FdrChip({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-[var(--text-muted)]">-</span>;
  return (
    <span
      className="inline-grid h-6 min-w-6 place-items-center rounded-md px-1.5 text-xs font-bold text-black"
      style={{ background: FDR_COLOR[value] ?? "var(--fdr-3)" }}
      title={`FDR ${value}`}
    >
      {value}
    </span>
  );
}
