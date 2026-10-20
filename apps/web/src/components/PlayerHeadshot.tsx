"use client";

import { useState } from "react";

const SIZES = { sm: 40, md: 56, lg: 96 } as const;
const STATUS_RING: Record<string, string> = {
  a: "var(--status-ok)",
  d: "var(--status-doubt)",
  i: "var(--status-out)",
  s: "var(--status-out)",
  u: "var(--status-out)",
  n: "var(--status-out)",
};

type Props = {
  name: string;
  /** URL kandidat berurutan: template utama → fallback (BLUEPRINT 6.3). */
  urls: string[];
  size?: keyof typeof SIZES;
  status?: string | null;
  teamColor?: string | null;
};

/** Foto kepala bulat (crop kepala & bahu) dengan cincin status FPL; fallback inisial. */
export function PlayerHeadshot({ name, urls, size = "md", status, teamColor }: Props) {
  const [index, setIndex] = useState(0);
  const px = SIZES[size];
  const ring = (status && STATUS_RING[status]) || teamColor || "var(--glass-border)";
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const src = urls[index];

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-elev)]"
      style={{ width: px, height: px, boxShadow: `0 0 0 2px ${ring}` }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL CDN dinamis + fallback berantai
        <img
          src={src}
          alt={name}
          width={px}
          height={px}
          loading="lazy"
          className="h-full w-full object-cover object-top"
          onError={() => setIndex((i) => i + 1)}
        />
      ) : (
        <span className="font-semibold text-[var(--text-muted)]" style={{ fontSize: px * 0.36 }}>
          {initials}
        </span>
      )}
    </span>
  );
}
