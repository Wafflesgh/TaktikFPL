import type { PricePoint } from "@/lib/data/analisis";
import { formatPrice, formatSnapshotDay } from "@/lib/time";

const W = 72;
const H = 24;
const PAD = 3;
const DAY_MS = 86_400_000;

/**
 * Sparkline harga (SVG inline, tanpa library). Sumbu x = hari kalender dalam jendela `days` yang
 * berakhir di `endDate`, jadi hari tanpa snapshot tampil sebagai jarak, bukan dirapatkan.
 */
export function Sparkline({ points, endDate, days }: { points: PricePoint[]; endDate: string; days: number }) {
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const pts = points
    .map((p) => ({ ...p, i: days - 1 - Math.round((end - new Date(`${p.date}T00:00:00Z`).getTime()) / DAY_MS) }))
    .filter((p) => p.i >= 0 && p.i < days);
  if (pts.length === 0) return <span className="inline-block w-14 text-center text-xs text-[var(--text-muted)] sm:w-[72px]">-</span>;

  const prices = pts.map((p) => p.priceTenths);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, days - 1);
  const y = (v: number) => (max === min ? H / 2 : PAD + ((max - v) * (H - 2 * PAD)) / (max - min));
  const first = pts[0];
  const last = pts[pts.length - 1];
  const color = last.priceTenths > first.priceTenths ? "var(--status-ok)" : last.priceTenths < first.priceTenths ? "var(--status-out)" : "var(--text-muted)";
  const label = `${days} days: ${formatPrice(first.priceTenths)} (${formatSnapshotDay(first.date)}) → ${formatPrice(last.priceTenths)} (${formatSnapshotDay(last.date)})${max !== min ? ` · range ${formatPrice(min)}–${formatPrice(max)}` : ""}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-14 shrink-0 sm:w-[72px]" role="img" aria-label={label}>
      <title>{label}</title>
      <line x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} stroke="currentColor" strokeOpacity={0.1} />
      {pts.length > 1 && (
        <polyline
          points={pts.map((p) => `${x(p.i)},${y(p.priceTenths)}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <circle cx={x(last.i)} cy={y(last.priceTenths)} r={2} fill={color} />
    </svg>
  );
}
