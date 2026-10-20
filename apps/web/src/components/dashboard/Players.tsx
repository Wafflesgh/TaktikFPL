import Link from "next/link";
import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { Panel, ProgressLine } from "@/components/ui";
import type { PlayerRow } from "@/lib/data/dashboard";
import { formatPrice } from "@/lib/time";

export const POSITIONS = ["GKP", "DEF", "MID", "FWD"] as const;
export const SORTS = { form: "Form", price: "Harga", owned: "Kepemilikan", xgi: "xGI/90" } as const;
export type Sort = keyof typeof SORTS;

const FORM_COLOR: Record<string, string> = {
  panas: "#F87171",
  bagus: "#4ADE80",
  stabil: "var(--accent)",
  menurun: "#FBBF24",
  dingin: "#38BDF8",
};

/** Daftar form teratas dengan garis progres (ref-02 panel "AI Prediction"). */
export function FormLeaders({ players }: { players: PlayerRow[] }) {
  return (
    <Panel title="Form Teratas" subtitle="Skor form vs pemain seposisi">
      <ul className="flex flex-col gap-3">
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-3">
            <PlayerHeadshot name={p.webName} urls={p.photos} size="sm" status={p.status} />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{p.webName}</span>
                <span className="tabular-nums text-[var(--text-muted)]">{Math.round((p.form?.score ?? 0) * 100)}%</span>
              </div>
              <ProgressLine value={p.form?.score ?? 0} color={FORM_COLOR[p.form?.label ?? ""] ?? "var(--accent)"} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Tabel pemain (desktop) / kartu (mobile) dengan filter posisi & urutan. */
export function PlayerTable({
  players,
  pos,
  sort,
  hrefFor,
}: {
  players: PlayerRow[];
  pos: string | undefined;
  sort: Sort;
  hrefFor: (patch: Record<string, string | undefined>) => string;
}) {
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 ${active ? "bg-[var(--accent)] text-white" : "bg-white/5 hover:bg-white/10"}`;
  return (
    <Panel
      title="Pemain"
      subtitle={`${players.length} pemain ditampilkan`}
      action={
        <div className="flex flex-wrap justify-end gap-1 text-xs">
          <Link href={hrefFor({ pos: undefined })} className={chip(!pos)}>Semua</Link>
          {POSITIONS.map((p) => (
            <Link key={p} href={hrefFor({ pos: p })} className={chip(pos === p)}>{p}</Link>
          ))}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-1 text-[var(--text-muted)]">Urutkan:</span>
        {(Object.keys(SORTS) as Sort[]).map((s) => (
          <Link key={s} href={hrefFor({ sort: s })} className={chip(sort === s)}>{SORTS[s]}</Link>
        ))}
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Belum ada data pemain.</p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="py-2 font-medium">Pemain</th>
                  <th className="font-medium">Pos</th>
                  <th className="text-right font-medium">Harga</th>
                  <th className="text-right font-medium">Owned</th>
                  <th className="text-right font-medium" title="Poin per laga: 4 laga terakhir / musim">Poin/laga</th>
                  <th className="text-right font-medium" title="xG + xA per 90 menit (4 laga, ter-shrink)">xGI/90</th>
                  <th className="pl-4 font-medium">Form</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                    <td className="py-2">
                      <span className="flex items-center gap-3">
                        <PlayerHeadshot name={p.webName} urls={p.photos} size="sm" status={p.status} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.webName}</span>
                          <span className="block truncate text-xs text-[var(--text-muted)]" title={p.news ?? undefined}>
                            {p.team?.short}
                            {p.news ? ` · ${p.news}` : ""}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>{p.position}</td>
                    <td className="text-right tabular-nums">{formatPrice(p.priceTenths)}</td>
                    <td className="text-right tabular-nums">{p.ownedPct ?? 0}%</td>
                    <td className="text-right tabular-nums">
                      {p.form?.last4Ppm != null ? `${p.form.last4Ppm.toFixed(1)} / ${(p.form.seasonPpm ?? 0).toFixed(1)}` : "-"}
                    </td>
                    <td className="text-right tabular-nums">{p.form?.last4Xgi90 != null ? p.form.last4Xgi90.toFixed(2) : "-"}</td>
                    <td className="pl-4">
                      <FormBadge label={p.form?.label} reasons={p.form?.reasons} pointsPerMatch={p.form?.last4Ppm} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <ul className="grid gap-2 md:hidden">
            {players.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-2 pr-3">
                <PlayerHeadshot name={p.webName} urls={p.photos} status={p.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.webName}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    {p.team?.short} · {p.position} · {formatPrice(p.priceTenths)} · {p.ownedPct ?? 0}%
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <FormBadge label={p.form?.label} reasons={p.form?.reasons} pointsPerMatch={p.form?.last4Ppm} />
                  {p.form?.last4Ppm != null && (
                    <span className="text-xs tabular-nums text-[var(--text-muted)]">{p.form.last4Ppm.toFixed(1)} pts</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
