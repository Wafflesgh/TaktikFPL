"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "auto" | "30" | "60" | "720" | "off";

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "auto", label: "Auto", hint: "every 30 min in the 24 h before a deadline, otherwise hourly" },
  { key: "30", label: "30 min", hint: "every 30 minutes" },
  { key: "60", label: "1 hour", hint: "every hour" },
  { key: "720", label: "12 hours", hint: "every 12 hours" },
  { key: "off", label: "Off", hint: "manual refresh only" },
];
const KEY = "tfpl_refresh";
const DAY = 864e5;

const EVENT = "tfpl-refresh-mode";
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function load(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.some((m) => m.key === v) ? (v as Mode) : "auto";
  } catch {
    return "auto";
  }
}

type Status = { deadline: number | null; synced: number | null };

async function fetchStatus(): Promise<Status> {
  const supabase = createClient();
  const [gw, run] = await Promise.all([
    supabase.from("gameweeks").select("deadline_utc").eq("is_next", true).maybeSingle(),
    supabase
      .from("job_runs")
      .select("finished_at")
      .in("job_name", ["sync_bootstrap", "deadline_checkpoint"])
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    deadline: gw.data?.deadline_utc ? Date.parse(gw.data.deadline_utc) : null,
    synced: run.data?.finished_at ? Date.parse(run.data.finished_at) : null,
  };
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

/**
 * Pembaruan otomatis halaman (per perangkat, localStorage): render ulang data server pada interval pilihan.
 * Data di DB sendiri diperbarui worker tiap ±15 menit (tiap tick dalam 24 jam sebelum deadline);
 * "synced" = sinkron FPL terakhir yang sukses.
 */
export function AutoRefresh() {
  const router = useRouter();
  const mode = useSyncExternalStore(subscribe, load, () => "auto" as Mode);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [synced, setSynced] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((st: Status) => {
    setDeadline(st.deadline);
    setSynced(st.synced);
    setNow(Date.now());
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    router.refresh();
    apply(await fetchStatus());
    setBusy(false);
  }, [router, apply]);

  useEffect(() => {
    let alive = true;
    fetchStatus().then((st) => alive && apply(st));
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [apply]);

  const nearDeadline = deadline != null && now != null && deadline - now > 0 && deadline - now <= DAY;
  const minutes = mode === "off" ? null : mode === "auto" ? (nearDeadline ? 30 : 60) : Number(mode);

  useEffect(() => {
    if (minutes == null) return;
    const t = setInterval(() => void refresh(), minutes * 60000);
    return () => clearInterval(t);
  }, [minutes, refresh]);

  const choose = (m: Mode) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* penyimpanan diblokir: pilihan tidak tersimpan */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <details className="relative mr-1 hidden md:block">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 whitespace-nowrap rounded-full bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
        title="Auto-update settings"
      >
        <span className={`h-2 w-2 rounded-full ${minutes != null ? "bg-[var(--status-ok)]" : "bg-white/30"} ${busy ? "animate-ping" : ""}`} />
        {minutes != null ? `Auto · ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}` : "Auto off"}
      </summary>
      <div className="glass absolute right-0 z-40 mt-2 w-72 p-3 text-sm">
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Data synced {synced != null && now != null ? `${ago(now - synced)} ago` : "—"} · the worker syncs FPL every 15–30 min
          {nearDeadline ? " (every tick: deadline within 24 h)" : ""}.
        </p>
        <div className="flex flex-col gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => choose(m.key)}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-white/10 ${mode === m.key ? "bg-[var(--accent-soft)]" : ""}`}
            >
              <span className="font-medium">{m.label}</span>
              <span className="ml-2 text-right text-[11px] text-[var(--text-muted)]">{m.hint}</span>
            </button>
          ))}
        </div>
        <button onClick={() => void refresh()} disabled={busy} className="mt-2 w-full rounded-full bg-[var(--accent)] py-1.5 text-sm text-white disabled:opacity-60">
          {busy ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
    </details>
  );
}
