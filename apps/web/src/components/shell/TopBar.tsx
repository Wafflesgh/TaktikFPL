import Link from "next/link";
import { BellIcon, SearchIcon, SettingsIcon } from "@/components/icons";
import { TopNav } from "@/components/shell/NavLinks";

type Props = {
  displayName: string;
  isAdmin: boolean;
  liveCount: number;
};

const iconBtn =
  "grid h-10 w-10 place-items-center rounded-full text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]";

/** Top bar desktop (ref-02): logo · nav pill · indikator Live · aksi · profil. */
export function TopBar({ displayName, isAdmin, liveCount }: Props) {
  const initials = displayName.slice(0, 2).toUpperCase();
  return (
    <header className="glass topbar sticky top-4 z-30 flex items-center justify-between gap-4 px-4 py-3 lg:px-6">
      <Link href="/" className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo statis kecil milik TaktikFPL */}
        <img src="/logo-128.png" alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
        <span className="font-display text-2xl uppercase tracking-wide">TaktikFPL</span>
      </Link>

      <div className="hidden lg:block">
        <TopNav />
      </div>

      <div className="flex items-center gap-1">
        <span
          className="mr-2 hidden items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm md:flex"
          title={liveCount > 0 ? `${liveCount} matches in progress` : "No matches in progress"}
        >
          <span className={`h-2 w-2 rounded-full ${liveCount > 0 ? "animate-pulse bg-[var(--live-red)]" : "bg-[var(--text-muted)]"}`} />
          Live{liveCount > 0 ? ` · ${liveCount}` : ""}
        </span>
        <span className={`${iconBtn} hidden md:grid cursor-not-allowed opacity-60`} title="Search — coming soon">
          <SearchIcon />
        </span>
        <span className={`${iconBtn} hidden md:grid cursor-not-allowed opacity-60`} title="Notifications — coming soon">
          <BellIcon />
        </span>
        {isAdmin && (
          <Link href="/admin/health" className={iconBtn} title="Admin · Health">
            <SettingsIcon />
          </Link>
        )}
        <details className="relative ml-1">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-full py-1 pl-1 pr-3 hover:bg-white/5">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--accent-soft)] font-semibold text-[var(--text)] ring-2 ring-[var(--accent)]">
              {initials}
            </span>
            <span className="hidden text-left leading-tight md:block">
              <span className="block text-sm font-semibold">{displayName}</span>
              <span className="block text-xs text-[var(--text-muted)]">FPL Manager</span>
            </span>
          </summary>
          <div className="glass absolute right-0 mt-2 w-44 p-2 text-sm">
            <Link href="/pengaturan" className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">
              Settings
            </Link>
          </div>
        </details>
      </div>
    </header>
  );
}
