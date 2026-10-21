"use client";

import { useSyncExternalStore } from "react";
import { ClockIcon } from "@/components/icons";
import { StatTile } from "@/components/ui";
import { countdown, countdownShort } from "@/lib/time";

const TICK_MS = 30_000;

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, TICK_MS);
  return () => clearInterval(id);
}

// Snapshot = awal jendela 30 detik saat ini: stabil antar-render, berubah tiap tick.
const tickNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;

/**
 * Tile Deadline di Beranda yang diperbarui tiap 30 detik. Hanya teks yang berganti (tanpa animasi),
 * jadi aman untuk prefers-reduced-motion. `serverNow` membuat HTML server & hidrasi sama persis.
 */
export function DeadlineTile({ deadlineUtc, serverNow }: { deadlineUtc: string; serverNow: number }) {
  const now = new Date(useSyncExternalStore(subscribe, tickNow, () => serverNow));
  return (
    <StatTile
      label="Deadline"
      icon={<ClockIcon size={16} />}
      value={<time dateTime={deadlineUtc}>{countdownShort(deadlineUtc, now)}</time>}
      hint={`${countdown(deadlineUtc, now)} (days·hours·mins)`}
    />
  );
}
