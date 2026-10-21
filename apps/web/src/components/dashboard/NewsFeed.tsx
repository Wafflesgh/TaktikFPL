"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Panel } from "@/components/ui";
import type { NewsEntry } from "@/lib/data/news";
import { createClient } from "@/lib/supabase/client";
import { formatWIB } from "@/lib/time";

const SIGNAL: Record<string, { label: string; cls: string }> = {
  injury: { label: "Injury", cls: "bg-red-500/15 text-red-300" },
  doubt: { label: "Doubt", cls: "bg-amber-500/15 text-amber-300" },
  suspension: { label: "Suspension", cls: "bg-red-500/15 text-red-300" },
  unavailable: { label: "Unavailable", cls: "bg-red-500/15 text-red-300" },
  return_to_training: { label: "Returning", cls: "bg-green-500/15 text-green-300" },
  fit: { label: "Fit", cls: "bg-green-500/15 text-green-300" },
  transfer: { label: "Transfer", cls: "bg-sky-500/15 text-sky-300" },
  manager_change: { label: "Manager", cls: "bg-sky-500/15 text-sky-300" },
  lineup_leak: { label: "Team news", cls: "bg-violet-500/15 text-violet-300" },
};

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/**
 * Berita FPL di Home: artikel RSS + perubahan status pemain dari FPL. Realtime: setiap baris baru di
 * news_items / player_status_snapshots memicu render ulang server (tanpa reload), item baru disorot.
 */
export function NewsFeed({ items, serverNow }: { items: NewsEntry[]; serverNow: number }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "fpl" | "article">("all");
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(serverNow);
  // Item yang sudah ada saat halaman dibuka; yang muncul belakangan (Realtime) ditandai "New".
  const [initial] = useState(() => new Set(items.map((i) => i.key)));
  const fresh = items.filter((i) => !initial.has(i.key)).map((i) => i.key);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    const channel = supabase
      .channel("home-news")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "news_items" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "player_status_snapshots" }, refresh)
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [router]);

  const shown = items.filter((i) => filter === "all" || i.kind === filter).slice(0, 14);
  return (
    <Panel
      title="FPL News"
      subtitle="Injuries, team news and transfers · FPL status updates + BBC, Guardian, Sky, FF Scout"
      action={
        <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]" title={live ? "Realtime connected: new items appear automatically" : "Connecting…"}>
          <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-[var(--status-ok)]" : "bg-white/30"}`} />
          {live ? "Live" : "…"}
        </span>
      }
    >
      <div className="mb-3 flex gap-1.5 text-xs">
        {(["all", "fpl", "article"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 ${filter === f ? "bg-[var(--accent)] text-white" : "bg-white/5 text-[var(--text-muted)] hover:bg-white/10"}`}
          >
            {f === "all" ? "All" : f === "fpl" ? "FPL status" : "Articles"}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No news yet — the worker checks feeds every 15 minutes.</p>
      ) : (
        <ul className="flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1">
          {shown.map((n) => {
            const sig = n.signal ? SIGNAL[n.signal] : null;
            const isNew = fresh.includes(n.key);
            return (
              <li key={n.key} className={`rounded-xl border p-2.5 text-sm ${isNew ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-white/5 bg-white/[0.03]"}`}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">{n.source}</span>
                  <span title={formatWIB(n.at)}>· {ago(n.at, now)}</span>
                  {sig && <span className={`rounded-full px-1.5 py-0.5 ${sig.cls}`}>{sig.label}</span>}
                  {n.chanceNext != null && n.kind === "fpl" && <span>· {n.chanceNext}% next GW</span>}
                  {isNew && <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-white">New</span>}
                </div>
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:text-[var(--accent)]">
                    {n.title}
                  </a>
                ) : (
                  <p className="font-medium leading-snug">{n.title}</p>
                )}
                {n.players.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {n.players.slice(0, 4).map((p) => (
                      <Link key={p.id} href={`/pemain/${p.id}`} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20">
                        {p.name}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
