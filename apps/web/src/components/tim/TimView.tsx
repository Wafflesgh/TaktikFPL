import Link from "next/link";
import { setEntry } from "@/app/tim/actions";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { Reasons } from "@/components/Reasons";
import { Panel } from "@/components/ui";
import type { TimData } from "@/lib/data/tim";
import type { ProjPlayer, TransferIdea } from "@/lib/reco";
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

type Ready = Exclude<TimData, { status: "no_projections" }>;

/** Squad awal yang direkomendasikan (ILP) — untuk yang belum punya tim di FPL. */
function StartingSquad({ data }: { data: Ready }) {
  const opt = data.optimal;
  if (!opt) return null;
  const { firstGw, horizonGw } = data;
  const xi = data.optimalPlayers.filter((p) => opt.starters.includes(p.id));
  const xiNext = xi.reduce((s, p) => s + (p.byGw[firstGw] ?? 0), 0);
  const captain = data.optimalPlayers.find((p) => p.id === opt.captain);
  return (
    <Panel
      title="Recommended starting squad"
      subtitle={`No team yet? Build this on FPL. £${(opt.costTenths / 10).toFixed(1)}m of £100.0m · £${((1000 - opt.costTenths) / 10).toFixed(1)}m left in the bank`}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: `XI xPts GW${firstGw}`, value: xiNext.toFixed(1) },
          { label: `XI xPts ${horizonGw} GWs`, value: xi.reduce((s, p) => s + p.horizon, 0).toFixed(1) },
          { label: "Captain", value: captain?.name ?? "-" },
          { label: "Formation", value: ["DEF", "MID", "FWD"].map((pos) => xi.filter((p) => p.position === pos).length).join("-") },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl bg-white/5 p-3">
            <p className="text-xs text-[var(--text-muted)]">{t.label}</p>
            <p className="mt-1 truncate font-display text-2xl leading-none">{t.value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {POS_ORDER.map((pos) => (
          <div key={pos}>
            <p className="mb-1 text-xs uppercase tracking-wider text-[var(--text-muted)]">{pos}</p>
            <ul className="flex flex-col gap-1">
              {data.optimalPlayers
                .filter((p) => p.position === pos)
                .sort((a, b) => Number(opt.starters.includes(b.id)) - Number(opt.starters.includes(a.id)) || b.horizon - a.horizon)
                .map((p) => {
                  const starter = opt.starters.includes(p.id);
                  return (
                    <li key={p.id} className={`flex flex-wrap items-center gap-3 rounded-xl px-2 py-1.5 ${starter ? "bg-white/5" : "bg-white/[0.02] opacity-70"}`}>
                      <PlayerHeadshot name={p.name} urls={p.photos} size="sm" status={p.status} />
                      <div className="min-w-[9rem] flex-1">
                        <Link href={`/pemain/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                          {p.id === opt.captain ? " (C)" : ""}
                        </Link>
                        <p className="text-xs text-[var(--text-muted)]">
                          {p.teamShort} · {formatPrice(p.priceTenths)} {starter ? "" : "· bench"}
                        </p>
                        <Reasons reasons={p.reasons} max={3} className="mt-1" />
                      </div>
                      <GwStrip p={p} firstGw={firstGw} n={horizonGw} />
                      <span className="w-16 text-right text-sm font-semibold tabular-nums" title="Total 6-GW xPts (discounted)">
                        {p.horizon.toFixed(1)}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-[var(--text-muted)]">
        <li>On fantasy.premierleague.com choose <b>Pick Team</b> and add these 15 players (prices may move a little).</li>
        <li>Set the XI and captain as shown above, then save. Your Team ID appears in the Points page URL.</li>
        <li>Enter that Team ID above to get weekly transfer advice for your own squad.</li>
      </ol>
    </Panel>
  );
}

function Alternatives({ data }: { data: Ready }) {
  return (
    <Panel title="Alternatives by position" subtitle={`Best ${data.horizonGw}-GW xPts outside the recommended squad · value = xPts per £`}>
      <div className="flex flex-col gap-3 text-sm">
        {POS_ORDER.map((pos) => {
          const alt = data.alternatives[pos];
          if (!alt) return null;
          return (
            <div key={pos}>
              <p className="mb-1 text-xs uppercase tracking-wider text-[var(--text-muted)]">{pos}</p>
              <ul className="flex flex-col gap-0.5">
                {[...alt.top.map((p) => ({ p, tag: "" })), ...alt.value.map((p) => ({ p, tag: "value" }))].map(({ p, tag }) => (
                  <li key={p.id} className="flex items-center justify-between gap-2" title={p.reasons?.map((r) => r.text).join(" · ")}>
                    <Link href={`/pemain/${p.id}`} className="truncate hover:underline">
                      {p.name}
                      {tag && <span className="ml-1 rounded-full bg-green-500/15 px-1.5 text-[10px] text-green-300">{tag}</span>}
                    </Link>
                    <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
                      {p.teamShort} · {formatPrice(p.priceTenths)} · {p.horizon.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export type TimMode = "new" | "existing";

function ModeTabs({ mode }: { mode: TimMode }) {
  const tab = (m: TimMode, label: string, hint: string) => (
    <Link
      href={`/tim?mode=${m}`}
      className={`flex-1 rounded-2xl px-4 py-3 ${mode === m ? "bg-[var(--accent)] text-white" : "bg-white/5 hover:bg-white/10"}`}
    >
      <p className="font-semibold">{label}</p>
      <p className={`text-xs ${mode === m ? "text-white/80" : "text-[var(--text-muted)]"}`}>{hint}</p>
    </Link>
  );
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {tab("new", "Start a new team", "Pick all 15 players at once: free, no transfer cost")}
      {tab("existing", "I already have a team", "Transfers use your free transfers; extra ones cost −4")}
    </div>
  );
}

type Ok = Extract<TimData, { status: "ok" }>;

/** Kenapa pemain ini yang dijual & kenapa pengganti ini — hanya membandingkan angka engine yang sudah ada. */
function TransferWhy({ t, squad, firstGw, horizonGw }: { t: TransferIdea; squad: ProjPlayer[]; firstGw: number; horizonGw: number }) {
  const { out, in: inP } = t;
  const samePos = [...squad.filter((p) => p.position === out.position)].sort((a, b) => b.horizon - a.horizon);
  const rank = samePos.findIndex((p) => p.id === out.id) + 1;
  const gws = Array.from({ length: horizonGw }, (_, i) => firstGw + i);
  const ahead = gws.filter((gw) => (inP.byGw[gw] ?? 0) > (out.byGw[gw] ?? 0)).length;
  const outWarn = out.reasons.filter((r) => r.tone !== "good");
  const pos = out.position;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-white/5 pt-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-red-300">Why sell {out.name}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--text-muted)]">
          <li>
            {rank === samePos.length ? "Lowest" : `#${rank} of ${samePos.length}`} {horizonGw}-GW xPts among your {pos}s ({out.horizon.toFixed(1)}
            {rank > 1 ? `; best ${samePos[0].name} ${samePos[0].horizon.toFixed(1)}` : ""})
          </li>
          <li>
            This sale gives the biggest upgrade in your squad (+{t.gainHorizon.toFixed(1)})
            {t.nextSwap ? `; next best swap: ${t.nextSwap.out.name} → ${t.nextSwap.in.name} (+${t.nextSwap.gainHorizon.toFixed(1)})` : ""}
          </li>
        </ul>
        <Reasons reasons={outWarn.length ? outWarn : out.reasons} max={3} className="mt-1.5" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-green-300">Why {inP.name}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--text-muted)]">
          <li>
            Highest {horizonGw}-GW xPts ({inP.horizon.toFixed(1)}) of {t.options} {pos}s you can afford (≤ {formatPrice(t.maxPriceTenths)}, max 3 per club)
          </li>
          {t.runnerUp && (
            <li>
              Next option: {t.runnerUp.name} ({t.runnerUp.teamShort}, {formatPrice(t.runnerUp.priceTenths)}) {t.runnerUp.horizon.toFixed(1)} xPts
            </li>
          )}
          <li>
            Out-projects {out.name} in {ahead} of {horizonGw} GWs
          </li>
        </ul>
        <Reasons reasons={inP.reasons} max={3} className="mt-1.5" />
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
        {[out, inP].map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className={`w-20 truncate ${p === out ? "text-red-300" : "text-green-300"}`}>{p.name}</span>
            <GwStrip p={p} firstGw={firstGw} n={horizonGw} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TransferPlanPanel({ data }: { data: Ok }) {
  const { firstGw, horizonGw, plans, bestPlan, freeTransfers, ftEstimate } = data;
  const unlimited = ftEstimate == null && !data.ftOverridden;
  return (
    <Panel
      title="Transfer plan"
      subtitle={`GW${firstGw} · gain = xPts over ${horizonGw} GWs (0.85 weight per GW) · each transfer beyond your free ones costs −4`}
    >
      <form method="get" action="/tim" className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="mode" value="existing" />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)]">
            Free transfers{" "}
            {unlimited ? "(new team: unlimited before its first deadline)" : ftEstimate != null ? `(estimated ${ftEstimate} from your history)` : ""}
          </span>
          <input
            name="ft"
            type="number"
            min={0}
            max={data.maxFreeTransfers}
            defaultValue={unlimited ? "" : freeTransfers}
            placeholder={unlimited ? "∞" : undefined}
            className="w-24 rounded-xl border border-[var(--glass-border)] bg-black/30 px-3 py-1.5"
          />
        </label>
        <button type="submit" className="rounded-full bg-white/10 px-4 py-1.5 hover:bg-white/20">
          Update
        </button>
      </form>

      <table className="mb-3 w-full text-sm">
        <thead className="text-xs text-[var(--text-muted)]">
          <tr>
            <th className="py-1 text-left">Option</th>
            <th className="text-right">Gain</th>
            <th className="text-right">Hit</th>
            <th className="text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => {
            const best = p === bestPlan;
            const n = p.transfers.length;
            return (
              <tr key={n} className={`border-t border-white/5 tabular-nums ${best ? "font-semibold text-green-300" : ""}`}>
                <td className="py-1">
                  {n === 0 ? "Roll (no transfer)" : `${n} transfer${n > 1 ? "s" : ""}`}
                  {best ? " ← best" : ""}
                </td>
                <td className="text-right">+{p.gainHorizon.toFixed(1)}</td>
                <td className="text-right">{p.hits ? `−${p.hits * 4}` : "0"}</td>
                <td className="text-right">
                  {p.net >= 0 ? "+" : ""}
                  {p.net.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {bestPlan.transfers.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No transfer clearly beats rolling: save your free transfer.</p>
      ) : (
        <ol className="flex flex-col gap-3 text-sm">
          {bestPlan.transfers.map((t, i) => (
            <li key={t.out.id} className="rounded-xl bg-white/5 p-3">
              <p className="font-semibold">
                {i + 1}. {t.out.name} →{" "}
                <Link href={`/pemain/${t.in.id}`} className="text-[var(--accent)] hover:underline">
                  {t.in.name}
                </Link>
                {i >= freeTransfers && <span className="ml-2 rounded-full bg-red-500/20 px-2 text-xs text-red-200">−4 hit</span>}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {t.in.teamShort} · {formatPrice(t.in.priceTenths)} · bank after {formatPrice(t.budgetLeftTenths)}
              </p>
              <p className="mt-1">
                <span className="text-green-300">+{t.gainHorizon.toFixed(1)} xPts</span> over {horizonGw} GWs
                <span className="text-[var(--text-muted)]">
                  {" "}
                  · GW{firstGw}: {t.gainNext >= 0 ? "+" : ""}
                  {t.gainNext.toFixed(1)}
                </span>
              </p>
              <TransferWhy t={t} squad={data.squad} firstGw={firstGw} horizonGw={horizonGw} />
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        FPL&apos;s public API doesn&apos;t show free transfers, so the number is estimated from your transfer history. Correct it above if
        needed. Selling price assumed = current price.
      </p>
    </Panel>
  );
}

export function TimView({ data, entryId, mode }: { data: TimData; entryId: number | null; mode: TimMode }) {
  if (data.status === "no_projections") {
    return (
      <Panel title="My Team">
        <p className="text-sm text-[var(--text-muted)]">Projections not available yet. The worker computes them daily (run_projections job).</p>
      </Panel>
    );
  }
  const { firstGw, horizonGw } = data;
  const lastGw = firstGw + horizonGw - 1;

  if (mode === "new") {
    return (
      <main className="flex flex-col gap-6">
        <ModeTabs mode={mode} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
            <StartingSquad data={data} />
          </div>
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
            <Panel title="How a new team works" subtitle="Different from transferring in an existing team">
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">
                <li>You pick all 15 players at once for free: no transfer cost, no −4 hits.</li>
                <li>Until your first deadline (GW{firstGw}) you can change them as often as you like.</li>
                <li>After that you get free transfers each gameweek; extra transfers cost −4 points each.</li>
                <li>
                  This squad is optimised for GW{firstGw}–{lastGw}, not just one week. The Best XI on Home is for GW{firstGw} only.
                </li>
              </ul>
            </Panel>
            <Alternatives data={data} />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <ModeTabs mode={mode} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
        <Panel
          title={data.status === "ok" ? data.entry.name : "My Team"}
          subtitle={
            data.status === "ok"
              ? `${data.entry.player_first_name} ${data.entry.player_last_name} · squad GW${data.picksGw} · bank ${formatPrice(data.bankTenths)} · rank ${data.entry.summary_overall_rank?.toLocaleString("en-GB") ?? "-"}`
              : "Enter your FPL Team ID to see your squad and transfer plan"
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
                            <Reasons reasons={p.reasons} max={3} className="mt-1" />
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

            <TransferPlanPanel data={data} />

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

        {data.status === "ok" && data.optimal && (
          <Panel title="If you play your Wildcard" subtitle={`${data.optimal.title} · £${(data.optimal.costTenths / 10).toFixed(1)}m`}>
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
              All 15 changed for free with the Wildcard chip. Your real budget is squad value + bank, not exactly £100.0m.
            </p>
          </Panel>
        )}
      </div>
      </div>
    </main>
  );
}
