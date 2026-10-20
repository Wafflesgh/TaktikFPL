import { formatInTimeZone } from "date-fns-tz";
import { id } from "date-fns/locale";

export const WIB = "Asia/Jakarta";

/** "Sab, 25 Okt 2026 · 21:00 WIB" (BLUEPRINT 11.6). Input selalu UTC (ISO). */
export function formatWIB(iso: string | null | undefined): string {
  if (!iso) return "TBC";
  return `${formatInTimeZone(new Date(iso), WIB, "EEE, d MMM yyyy · HH:mm", { locale: id })} WIB`;
}

export function formatTimeWIB(iso: string | null | undefined): string {
  if (!iso) return "TBC";
  return `${formatInTimeZone(new Date(iso), WIB, "HH:mm", { locale: id })} WIB`;
}

export function formatDayWIB(iso: string): string {
  return formatInTimeZone(new Date(iso), WIB, "EEE, d MMM", { locale: id });
}

/** Sisa waktu ke deadline: "3h 12j 40m" (h = hari, j = jam, m = menit). */
export function countdown(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "lewat";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return `${d}h ${h}j ${m % 60}m`;
}

export function formatPrice(tenths: number | null | undefined): string {
  return tenths == null ? "-" : `£${(tenths / 10).toFixed(1)}m`;
}

/** Ringkas untuk kartu: "3 hari", "5 jam", "12 menit". */
export function countdownShort(iso: string, now: Date = new Date()): string {
  const m = Math.floor((new Date(iso).getTime() - now.getTime()) / 60000);
  if (m <= 0) return "lewat";
  if (m >= 1440) return `${Math.floor(m / 1440)} hari`;
  if (m >= 60) return `${Math.floor(m / 60)} jam`;
  return `${m} menit`;
}

export function minutesSince(iso: string, now: Date = new Date()): number {
  return Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
}
