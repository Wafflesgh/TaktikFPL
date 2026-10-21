import Link from "next/link";
import { Panel } from "@/components/ui";
import type { SeasonPlanData } from "@/lib/data/season";
import type { ChipOption } from "@/lib/season";
import { formatWIB } from "@/lib/time";

const fmt = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(1));
const signed = (v: number | null | undefined) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
// Chip yang hanya layak dipakai bila gain-nya positif (Free Hit & Wildcard dibandingkan dengan squad Anda).
const NEEDS_POSITIVE = new Set(["freehit", "wildcard"]);

type ChipCard = {
  key: string;
  label: string;
  name: string;
  window: string;
  used: boolean;
  usedGw: number | null;
  pick: ChipOption | null;
  options: ChipOption[];
  margin: number | null;
};

function ChipCards({ cards }: { cards: ChipCard[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {cards.map((c) => {
        const worth = c.pick && (!NEEDS_POSITIVE.has(c.name) || c.pick.value > 0);
        return (
          <div key={c.key} className="rounded-2xl bg-white/5 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold">{c.label}</p>
              <span className="text-xs text-[var(--text-muted)]">window {c.window}</span>
            </div>
            {c.used ? (
              <p className="mt-2 text-[var(--text-muted)]">Already used in GW{c.usedGw}.</p>
            ) : !c.pick ? (
              <p className="mt-2 text-[var(--text-muted)]">No gameweek left in this window.</p>
            ) : (
              <>
                <p className="mt-2">
                  {worth ? (
                    <>
                      Best: <b className="text-lg text-green-300">GW{c.pick.gw}</b>
                    </>
                  ) : (
                    <span className="text-amber-300">Hold. No gameweek gains anything yet (best GW{c.pick.gw}).</span>
                  )}
                </p>
                <p className="text-xs text-[var(--text-muted)]">{c.pick.text}</p>
                {c.margin != null && <p className="text-xs text-[var(--text-muted)]">{signed(c.margin)} xPts ahead of the next-best GW</p>}
                <table className="mt-2 w-full text-xs tabular-nums">
                  <tbody>
                    {c.options.slice(0, 4).map((o) => (
                      <tr key={o.gw} className="border-t border-white/5">
                        <td className="py-0.5">GW{o.gw}</td>
                        <td className="text-right">{signed(o.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PlanView({ data }: { data: SeasonPlanData | null }) {
  if (!data) {
    return (
      <Panel title="Season plan">
        <p className="text-sm text-[var(--text-muted)]">
          Not available yet. The worker builds it with the projection run (needs the season-plan database migration).
        </p>
      </Panel>
    );
  }
  const { plan, user, snapshots } = data;
  const window = (a: number, b: number) => `GW${a}–${b}`;

  const cards: ChipCard[] = user
    ? user.chips.map((c) => ({
        key: `${c.name}-${c.start_event}`,
        label: c.label,
        name: c.name,
        window: window(c.start_event, c.stop_event),
        used: c.used,
        usedGw: c.usedGw,
        pick: c.pick,
        options: c.options,
        margin: c.pick && c.options[1] ? c.options[0].value - c.options[1].value : null,
      }))
    : plan.chips.map((c) => ({
        key: `${c.name}-${c.start_event}`,
        label: c.label,
        name: c.name,
        window: window(c.start_event, c.stop_event),
        used: false,
        usedGw: null,
        pick: c.best[0] ?? null,
        options: c.best,
        margin: c.margin_vs_next,
      }));
  if (!user) {
    // Satu chip per GW juga untuk squad acuan: chip dengan nilai terbesar memilih lebih dulu.
    const taken = new Set<number>();
    for (const c of [...cards].sort((a, b) => (b.options[0]?.value ?? 0) - (a.options[0]?.value ?? 0))) {
      c.pick = c.options.find((o) => !taken.has(o.gw)) ?? null;
      if (c.pick) taken.add(c.pick.gw);
    }
  }
  const chipGw = new Map(cards.filter((c) => c.pick && !c.used).map((c) => [c.pick!.gw, c.label]));
  const userByGw = new Map((user?.gws ?? []).map((g) => [g.gw, g]));

  return (
    <main className="flex flex-col gap-6">
      <Panel
        title={`Season plan · GW${plan.first_gw}–${plan.last_gw}`}
        subtitle={`Updated ${formatWIB(data.createdAt)} · ${user ? `for your squad (${user.entryName}, GW${user.squadGw} picks)` : "for the recommended squad (enter your Team ID on My Team for your own plan)"}`}
      >
        <ChipCards cards={cards} />
        {!user && (
          <p className="mt-3 text-sm">
            <Link href="/tim?mode=existing" className="text-[var(--accent)] hover:underline">
              Add your FPL Team ID
            </Link>{" "}
            to plan chips around your own squad and the chips you have already used.
          </p>
        )}
      </Panel>

      <Panel
        title="Gameweek by gameweek"
        subtitle="xPts from the engine for every remaining GW. Further GWs are less certain: form, injuries and prices change."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr>
                <th className="py-1 text-left">GW</th>
                <th className="text-left">Fixtures</th>
                <th className="text-right" title="Best XI from the squad (captain not doubled)">XI xPts</th>
                <th className="text-right">Bench</th>
                <th className="text-left pl-3">Captain</th>
                <th className="text-right" title="Best one-week squad (XI + captain) minus yours">Free Hit</th>
                <th className="text-right" title="Best 6-GW squad from this GW minus yours, after the free transfers you would make anyway">Wildcard</th>
                <th className="pl-3 text-left">Chip</th>
              </tr>
            </thead>
            <tbody>
              {plan.gws.map((r) => {
                const u = userByGw.get(r.gw);
                const xi = u?.xi ?? r.template_xi;
                const bench = u?.bench ?? r.template_bench;
                const capId = u?.captain.id ?? r.template_captain.id;
                const capX = u?.captain.xpts ?? r.template_captain.xpts;
                const fh = u?.fhGain ?? r.fh_gain;
                const wc = u ? u.wcGain : (r.wc?.gain ?? null);
                return (
                  <tr key={r.gw} className="border-t border-white/5 tabular-nums">
                    <td className="py-1.5 font-medium">GW{r.gw}</td>
                    <td className="text-xs">
                      {r.dgw.length > 0 && <span className="mr-1 rounded-full bg-green-500/15 px-2 text-green-200">DGW {r.dgw.join(", ")}</span>}
                      {r.bgw.length > 0 && <span className="rounded-full bg-red-500/15 px-2 text-red-200">Blank {r.bgw.join(", ")}</span>}
                      {!r.dgw.length && !r.bgw.length && <span className="text-[var(--text-muted)]">normal</span>}
                    </td>
                    <td className="text-right">{fmt(xi)}</td>
                    <td className="text-right">{fmt(bench)}</td>
                    <td className="pl-3">
                      {capId ? <Link href={`/pemain/${capId}`} className="hover:underline">{data.name[capId] ?? "?"}</Link> : "?"} <span className="text-xs text-[var(--text-muted)]">{fmt(capX)}</span>
                    </td>
                    <td className={`text-right ${fh > 3 ? "text-green-300" : ""}`}>{signed(fh)}</td>
                    <td className={`text-right ${wc != null && wc > 3 ? "text-green-300" : ""}`}>{signed(wc)}</td>
                    <td className="pl-3 text-xs font-semibold text-[var(--accent)]">{chipGw.get(r.gw) ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Weekly baseline"
        subtitle="One saved plan per gameweek (kept permanently), so you can see how the recommended chip weeks moved as new data arrived"
      >
        {snapshots.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">The first snapshot is saved with the next projection run.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="py-1 text-left">Plan made</th>
                  {snapshots[0].chips.map((c) => (
                    <th key={c.name + c.start_event} className="text-right">
                      {c.label} ({c.start_event < 20 ? "1st" : "2nd"})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s, i) => {
                  const prev = snapshots[i + 1];
                  return (
                    <tr key={s.gw + s.createdAt} className="border-t border-white/5 tabular-nums">
                      <td className="py-1">
                        before GW{s.gw} <span className="text-xs text-[var(--text-muted)]">{formatWIB(s.createdAt)}</span>
                      </td>
                      {snapshots[0].chips.map((c) => {
                        const cur = s.chips.find((x) => x.name === c.name && x.start_event === c.start_event);
                        const old = prev?.chips.find((x) => x.name === c.name && x.start_event === c.start_event);
                        const moved = cur && old && cur.recommended_gw !== old.recommended_gw;
                        return (
                          <td key={c.name + c.start_event} className={`text-right ${moved ? "text-amber-300" : ""}`}>
                            {cur ? `GW${cur.recommended_gw}` : "-"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="How this is calculated">
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">
          <li>Every player gets an xPts projection for every remaining fixture (xPts v1: team attack/defence strength, minutes, scoring rules from FPL).</li>
          <li>
            <b>Triple Captain</b>: the GW where your best captain has the highest projection. <b>Bench Boost</b>: the GW where your 4 bench players
            score most. Usually double gameweeks.
          </li>
          <li>
            <b>Free Hit</b>: the GW where the best one-week £100m squad beats your XI by the most. Usually blank or double gameweeks.
          </li>
          <li>
            <b>Wildcard</b>: the GW where the best 6-GW squad beats yours by the most, after subtracting what your normal free transfers would recover
            anyway.
          </li>
          <li>Only one chip per gameweek; chip windows come from FPL. The plan is recalculated every projection run and saved once per GW.</li>
        </ul>
      </Panel>
    </main>
  );
}
