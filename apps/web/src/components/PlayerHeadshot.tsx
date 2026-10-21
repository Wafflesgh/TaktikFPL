"use client";

import { useEffect, useRef, useState } from "react";

const SIZES = { sm: 40, md: 56, lg: 96, cut: 72, cutSm: 54, xl: 260 } as const;
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

/**
 * Foto pemain. sm/md/lg: lingkaran (crop kepala & bahu) dengan cincin status FPL.
 * xl: potongan besar tanpa lingkaran untuk hero (ref-02); cut: potongan kecil tanpa lingkaran (lapangan Best XI).
 * Fallback: inisial.
 */
export function PlayerHeadshot({ name, urls, size = "md", status, teamColor }: Props) {
  const [index, setIndex] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  // Idempoten: hanya maju jika URL yang gagal adalah URL aktif (aman untuk efek ganda StrictMode).
  const advance = (failed: string | null) => setIndex((i) => (failed === urls[i] ? i + 1 : i));
  const px = SIZES[size];

  // Gambar yang gagal SEBELUM hidrasi tidak memicu onError React → cek manual saat mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) advance(img.getAttribute("src"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali saat mount; setelahnya onError yang menangani
  }, []);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const src = urls[index];

  if (size === "cut" || size === "cutSm") {
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element -- URL CDN dinamis + fallback berantai
      <img
        ref={imgRef}
        src={src}
        alt={name}
        width={px}
        height={px}
        loading="lazy"
        style={{ width: px, height: px }}
        className="object-contain object-bottom drop-shadow-[0_6px_10px_rgba(0,0,0,0.55)]"
        onError={(e) => advance(e.currentTarget.getAttribute("src"))}
      />
    ) : (
      <span className="grid place-items-center font-display text-xl text-white/80" style={{ width: px, height: px }}>
        {initials}
      </span>
    );
  }

  if (size === "xl") {
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element -- URL CDN dinamis + fallback berantai
      <img
        ref={imgRef}
        src={src}
        alt={name}
        width={px}
        height={px}
        className="relative h-auto w-[220px] object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)] xl:w-[260px]"
        onError={(e) => advance(e.currentTarget.getAttribute("src"))}
      />
    ) : (
      <span className="relative grid h-[220px] w-[220px] place-items-center rounded-full bg-[var(--bg-elev)] font-display text-7xl text-[var(--text-muted)]">
        {initials}
      </span>
    );
  }

  const ring = (status && STATUS_RING[status]) || teamColor || "var(--glass-border)";
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-elev)]"
      style={{ width: px, height: px, boxShadow: `0 0 0 2px ${ring}` }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL CDN dinamis + fallback berantai
        <img
          ref={imgRef}
          src={src}
          alt={name}
          width={px}
          height={px}
          loading="lazy"
          className="h-full w-full object-cover object-top"
          onError={(e) => advance(e.currentTarget.getAttribute("src"))}
        />
      ) : (
        <span className="font-semibold text-[var(--text-muted)]" style={{ fontSize: px * 0.36 }}>
          {initials}
        </span>
      )}
    </span>
  );
}
