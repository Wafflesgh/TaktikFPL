"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, ChartIcon, HomeIcon, LiveIcon, ShirtIcon } from "@/components/icons";

// Navigasi utama (BLUEPRINT 11.3). Halaman yang belum dibangun ditandai "segera".
export const NAV = [
  { href: "/", label: "Beranda", icon: HomeIcon, ready: true },
  { href: "/analisis", label: "Analisis", icon: ChartIcon, ready: true },
  { href: "/live", label: "Live", icon: LiveIcon, ready: false },
  { href: "/jadwal", label: "Jadwal", icon: CalendarIcon, ready: true },
  { href: "/tim", label: "Tim Saya", icon: ShirtIcon, ready: true },
] as const;

/** Desktop: pill berlabel untuk item aktif, lingkaran ikon untuk lainnya (ref-02). */
export function TopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigasi utama" className="flex items-center gap-2">
      {NAV.map(({ href, label, icon: Icon, ready }) => {
        const active = pathname === href;
        if (!ready) {
          return (
            <span
              key={href}
              title={`${label} — segera hadir`}
              aria-disabled="true"
              className="grid h-11 w-11 cursor-not-allowed place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-muted)] opacity-60"
            >
              <Icon />
              <span className="sr-only">{label} (segera)</span>
            </span>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "flex h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-5 font-medium text-white shadow-[0_0_24px_var(--accent-soft)]"
                : "grid h-11 w-11 place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-white/10"
            }
          >
            <Icon />
            {active ? label : <span className="sr-only">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile: bottom nav mengambang berbentuk pill dengan ikon bulat (ref-01 & ref-03). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit items-center gap-2 rounded-full border border-[var(--glass-border)] bg-black/85 p-2 lg:hidden"
    >
      {NAV.map(({ href, label, icon: Icon, ready }) => {
        const active = pathname === href;
        const cls = active
          ? "bg-[var(--accent)] text-white"
          : ready
            ? "bg-white/5 text-[var(--text)]"
            : "bg-white/5 text-[var(--text-muted)] opacity-50";
        return ready ? (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`grid h-12 w-12 place-items-center rounded-full ${cls}`}>
            <Icon />
            <span className="sr-only">{label}</span>
          </Link>
        ) : (
          <span key={href} aria-disabled="true" title={`${label} — segera`} className={`grid h-12 w-12 place-items-center rounded-full ${cls}`}>
            <Icon />
            <span className="sr-only">{label} (segera)</span>
          </span>
        );
      })}
    </nav>
  );
}
