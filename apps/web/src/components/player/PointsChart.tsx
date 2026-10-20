import type { GwBar } from "@/lib/data/player";

const SLOT = 22;
const BAR = 16;
const TOP = 16; // ruang label nilai
const PLOT = 120;
const AXIS = 16; // ruang label GW
const RADIUS = 4;

/** Batang dengan ujung data membulat 4px; pangkal tetap rata di garis nol. */
function barPath(x: number, base: number, end: number, w: number): string {
  const h = Math.abs(end - base);
  const r = Math.min(RADIUS, h, w / 2);
  if (end <= base) {
    // positif: ujung di atas
    return `M${x},${base} V${end + r} Q${x},${end} ${x + r},${end} H${x + w - r} Q${x + w},${end} ${x + w},${end + r} V${base} Z`;
  }
  // negatif: ujung di bawah
  return `M${x},${base} V${end - r} Q${x},${end} ${x + r},${end} H${x + w - r} Q${x + w},${end} ${x + w},${end - r} V${base} Z`;
}

/**
 * Poin per GW musim ini (SVG inline, tanpa library). Satu slot per GW musim; 4 GW terakhir yang
 * dimainkan memakai warna aksen. Hover/tap: tooltip bawaan via <title> dengan area sentuh selebar slot.
 */
export function PointsChart({ bars, highlight }: { bars: GwBar[]; highlight: Set<number> }) {
  if (bars.length === 0) return <p className="text-sm text-[var(--text-muted)]">Belum ada data gameweek musim ini.</p>;

  const values = bars.map((b) => b.points ?? 0);
  const max = Math.max(4, ...values);
  const min = Math.min(0, ...values);
  const scale = PLOT / (max - min);
  const zeroY = TOP + max * scale;
  const y = (v: number) => zeroY - v * scale;
  const width = bars.length * SLOT;
  const height = TOP + PLOT + AXIS;
  const best = Math.max(...values);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full text-[var(--text)]"
        style={{ minWidth: bars.length * 15 }}
        role="img"
        aria-label="Grafik batang poin per gameweek musim ini"
      >
        <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity={0.2} />
        {bars.map((b, i) => {
          const x = i * SLOT + (SLOT - BAR) / 2;
          const hot = highlight.has(b.gw);
          const p = b.points;
          const tip = b.played
            ? `GW${b.gw} · ${b.label}: ${p} poin`
            : b.finished
              ? `GW${b.gw}: tidak ada laga / tidak terdaftar`
              : `GW${b.gw}: belum dimainkan`;
          // Label nilai selektif: 4 GW terakhir + poin tertinggi musim. Nilai negatif ditulis di atas garis nol.
          const showValue = p != null && (hot || (p === best && p > 0));
          return (
            <g key={b.gw} className="group">
              <title>{tip}</title>
              <rect x={i * SLOT} y={0} width={SLOT} height={height} fill="transparent" />
              {p != null && p !== 0 && (
                <path
                  d={barPath(x, zeroY, y(p), BAR)}
                  fill={hot ? "var(--accent)" : "currentColor"}
                  fillOpacity={hot ? 1 : 0.28}
                  className="transition-opacity group-hover:opacity-80"
                />
              )}
              {p === 0 && <rect x={x} y={zeroY - 1} width={BAR} height={2} rx={1} fill="currentColor" fillOpacity={0.35} />}
              {showValue && (
                <text
                  x={x + BAR / 2}
                  y={(p >= 0 ? y(p) : zeroY) - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--text)"
                  className="tabular-nums"
                >
                  {p}
                </text>
              )}
              <text
                x={x + BAR / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize={8}
                fill="var(--text-muted)"
                fillOpacity={b.finished ? 1 : 0.5}
                fontWeight={hot ? 700 : 400}
              >
                {b.gw}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
