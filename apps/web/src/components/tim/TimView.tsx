import Link from "next/link";
import { setEntry } from "@/app/tim/actions";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { Panel } from "@/components/ui";
import type { TimData } from "@/lib/data/tim";
import type { ProjPlayer } from "@/lib/reco";
import { formatPrice } from "@/lib/time";

const POS_ORDER = ["GKP", "DEF", "MID", "FWD"];

/** Warna sel xPts per GW: makin tinggi makin hijau (skala sederhana 0–8 xPts). */
function cellStyle(x: number) {
  const t = Math.max(0, Math.min(1, x / 8));
  return { background: `rgba(34,197,94,${0.08 + t * 0.55})` };
}

function GwStrip({ p, firstGw, n }: { p: ProjPlayer; firstGw: number; n: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: n }, (_, i) => firstGw + i).map((gw) => {
        const x = p.byGw[gw];
        return (
          <span
            key={gw}
            title={`GW${gw}: ${x == null ? "no match (blank)" : x.toFixed(1) + " xPts"}`}
            className="grid h-7 w-9 place-items-center rounded-md text-[11px] tabular-nums"
            style={x == null ? { background: "rgba(255,255,255,0.04)" } : cellStyle(x)}
          >
            {x == null ? "–" : x.toFixed(1)}
          </span>
        );
      })}
    </div>
  );
}

function EntryForm({ entryId, message }: { entryId: number | null; message?: string }) {
  return (
    <form action={setEntry} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--text-muted)]">FPL Team ID (the number in your FPL Points page URL)</span>
        <input
          name="entry"
          defaultValue={entryId ?? ""}
          inputMode="numeric"
          placeholder="e.g. 1234567"
          className="w-56 rounded-xl border border-[var(--glass-border)] bg-black/30 px-3 py-2 outline-none focus:border-[var(--accent)]"
        />
      </label>
      <button type="submit" className="rounded-full bg-[var(--accent)] px-5 py-2 font-semibold text-white">
        {entryId ? "Change team" : "Show my team"}
      </button>
      {message && <p className="w-full text-sm text-amber-300">{message}</p>}
    </form>
  );
}

export function TimView({ data, entryId }: { data: TimData; entryId: number | null }) {
  if (data.status === "no_projections") {
    return (
      <Panel title="My Team">
        <p className="text-sm text-[var(--text-muted)]">Projections not available yet — the worker computes them daily (run_projections job).</p>
      </Panel>
    );
  }
  const { firstGw, horizonGw } = data;
  const lastGw = firstGw + horizonGw - 1;

  return (
    <main className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
        <Panel
          title={data.status === "ok" ? data.entry.name : "My Team"}
          subtitle={
            data.status === "ok"
              ? `${data.entry.player_first_name} ${data.entry.player_last_name} · squad GW${data.picksGw} · bank ${formatPrice(data.bankTenths)} · rank ${data.entry.summary_overall_rank?.toLocaleString("en-GB") ?? "-"}`
              : "Enter your FPL Team ID to see your squad and recommendations"
          }
        >
          <EntryForm
            entryId={entryId}
            message={
              data.status === "entry_not_found"
                ? "Team ID not found on FPL. Please check the number."
                : data.status === "no_picks"
                  ? "Squad not available from FPL yet (the team may have been created before its first GW)."
                  : undefined
            }
          />
        </Panel>

        {data.status === "ok" && (
          <Panel
            title={`Squad & projections GW${firstGw}–${lastGw}`}
            subtitle={`xPts per GW from the engine (${data.modelVersion}). Squad = your GW${data.picksGw} picks on FPL; transfers after the deadline are not visible yet.`}
          >
            <div className="flex flex-col gap-4">
              {POS_ORDER.map((pos) => {
                const rows = data.squad.filter((p) => p.position === pos);
                if (!rows.length) return null;
                return (
                  <div key={pos}>
                    <p className="mb-1 text-xs uppercase tracking-wider text-[var(--text-muted)]">{pos}</p>
                    <ul className="flex flex-col gap-1">
                      {rows.map((p) => (
                        <li key={p.id} className={`flex flex-wrap items-center gap-3 rounded-xl px-2 py-1.5 ${p.isStarter ? "bg-white/5" : "bg-white/[0.02] opacity-70"}`}>
                          <PlayerHeadshot name={p.name} urls={p.photos} size="sm" status={p.status} />
                          <div className="min-w-[9rem] flex-1">
                            <Link href={`/pemain/${p.id}`} className="font-medium hover:underline">
                              {p.name}
                              {p.isCaptain ? " (C)" : p.isVice ? " (V)" : ""}
                            </Link>
                            <p className="text-xs text-[var(--text-muted)]">
                              {p.teamShort} · {formatPrice(p.priceTenths)} {p.isStarter ? "" : "· bench"}
                            </p>
                          </div>
                          <GwStrip p={p} firstGw={firstGw} n={horizonGw} />
                          <span className="w-16 text-right text-sm font-semibold tabular-nums" title="Total 6-GW xPts (discounted)">
                            {p.horizon.toFixed(1)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
        {data.status === "ok" && (
          <>
            <Panel title="Captain" subtitle={`Highest GW${firstGw} projection in the starting XI`}>
              {data.captain ? (
                <p className="text-sm">
                  <b className="text-lg">{data.captain.name}</b> — {data.captain.next.toFixed(1)} xPts
                  {data.vice && (
                    <span className="block text-[var(--text-muted)]">
                      Vice: {data.vice.name} ({data.vice.next.toFixed(1)} xPts)
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">-</p>
              )}
            </Panel>

            <Panel title="Transfer recommendations" subtitle={`Based on total xPts for GW${firstGw}–${lastGw} (0.85 weight per GW), not just next GW`}>
              {data.transfers.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No clearly better transfer — save your free transfer.</p>
              ) : (
                <ol className="flex flex-col gap-3 text-sm">
                  {data.transfers.map((t, i) => (
                    <li key={t.out.id} className="rounded-xl bg-white/5 p-3">
                      <p className="font-semibold">
                        {i + 1}. {t.out.name} → <Link href={`/pemain/${t.in.id}`} className="text-[var(--accent)] hover:underline">{t.in.name}</Link>
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {t.in.teamShort} · {formatPrice(t.in.priceTenths)} · bank left {formatPrice(t.budgetLeftTenths)}
                      </p>
                      <p className="mt-1">
                        <span className="text-green-300">+{t.gainHorizon.toFixed(1)} xPts</span> over {horizonGw} GWs
                        <span className="text-[var(--text-muted)]"> · GW{firstGw}: {t.gainNext >= 0 ? "+" : ""}{t.gainNext.toFixed(1)}</span>
                      </p>
                      {t.gainHorizon < 4 && (
                        <p className="text-xs text-amber-300">Only worth it with a free transfer (a −4 hit isn&apos;t covered).</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-xs text-[var(--text-muted)]">Selling price assumed = current price; your FPL selling price may be slightly lower.</p>
            </Panel>

            {data.notes.length > 0 && (
              <Panel title="Player notes" subtitle="Consider the fixture run, not a single GW">
                <ul className="flex flex-col gap-2 text-sm">
                  {data.notes.map((n) => (
                    <li key={n.player.id}>
                      <span className={n.kind === "tahan" ? "text-sky-300" : "text-red-300"}>{n.kind === "tahan" ? "Hold" : "Sell"}:</span>{" "}
                      <b>{n.player.name}</b> — {n.reason}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}

        {data.optimal && (
          <Panel title="Build from scratch (wildcard)" subtitle={`${data.optimal.title} · £${(data.optimal.costTenths / 10).toFixed(1)}m`}>
            <ul className="flex flex-col gap-1 text-sm">
              {POS_ORDER.flatMap((pos) =>
                data.optimalPlayers
                  .filter((p) => p.position === pos)
                  .map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="mr-2 inline-block w-9 text-xs text-[var(--text-muted)]">{pos}</span>
                        <Link href={`/pemain/${p.id}`} className="hover:underline">{p.name}</Link>
                        {p.id === data.optimal?.captain ? " (C)" : ""}
                        {data.optimal?.starters.includes(p.id) ? "" : <span className="text-xs text-[var(--text-muted)]"> · bench</span>}
                      </span>
                      <span className="tabular-nums text-[var(--text-muted)]">
                        {p.teamShort} · {formatPrice(p.priceTenths)} · {p.horizon.toFixed(1)}
                      </span>
                    </li>
                  )),
              )}
            </ul>
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              ILP optimisation: £100.0m budget, 2-5-5-3, max 3 per club, maximising {horizonGw}-GW xPts.
            </p>
          </Panel>
        )}
      </div>
    </main>
  );
}
