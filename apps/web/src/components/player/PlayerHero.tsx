import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { TeamBadge, TeamLink } from "@/components/ui";
import type { ProfilePlayer, SeasonSummary } from "@/lib/data/player";
import { formatPrice, formatWIB } from "@/lib/time";

// Kode status FPL (bootstrap-static elements.status) → label UI.
const STATUS: Record<string, { text: string; color: string }> = {
  a: { text: "Fit", color: "var(--status-ok)" },
  d: { text: "Doubtful", color: "var(--status-doubt)" },
  i: { text: "Injured", color: "var(--status-out)" },
  s: { text: "Suspended", color: "var(--status-out)" },
  u: { text: "Unavailable", color: "var(--status-out)" },
  n: { text: "Not eligible", color: "var(--status-out)" },
};

/** Header profil (wireframe B): headshot besar, identitas, status FPL, form + alasan, ringkasan musim. */
export function PlayerHero({
  player,
  season,
  seasonLabel,
}: {
  player: ProfilePlayer;
  season: SeasonSummary | null;
  seasonLabel: string | null;
}) {
  const f = player.form;
  const status = player.status ? STATUS[player.status] : null;
  const stats = [
    { label: "Season points", value: season?.points ?? "-" },
    { label: "Minutes", value: season?.minutes ?? "-" },
    { label: "Goals · Assists", value: season ? `${season.goals} · ${season.assists}` : "-" },
    { label: "Season xGI", value: season?.xgi != null ? season.xgi.toFixed(2) : "-" },
    { label: "Pts/match (last 4)", value: f?.last4Ppm?.toFixed(1) ?? "-" },
    { label: "Points per 90", value: season?.pointsPer90 != null ? season.pointsPer90.toFixed(1) : "-" },
  ];

  return (
    <section className="glass relative overflow-hidden p-0">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 90% at 80% 40%, var(--accent-soft), transparent 70%), linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.55))",
        }}
      />
      <div className="relative grid gap-6 p-5 md:grid-cols-[1fr_auto] md:p-8">
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Player profile{seasonLabel ? ` · ${seasonLabel}` : ""}
            </p>
            <h1 className="mt-2 break-words font-display text-5xl uppercase leading-none xl:text-7xl">{player.webName}</h1>
            {player.fullName !== player.webName && <p className="mt-1 text-sm text-[var(--text-muted)]">{player.fullName}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
              {player.team && <TeamBadge url={player.team.badge} short={player.team.short} size={32} />}
              <TeamLink team={player.team} className="font-medium">{player.team?.name ?? "No club"}</TeamLink>
              {[player.position, formatPrice(player.priceTenths), player.ownedPct != null ? `${player.ownedPct}% owned` : "owned -"]
                .filter(Boolean)
                .map((v) => (
                  <span key={v} className="whitespace-nowrap tabular-nums">
                    <span className="mr-2 text-[var(--text-muted)]">·</span>
                    {v}
                  </span>
                ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {status ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: status.color }} />
                  {status.text}
                  {player.chanceNext != null && player.status !== "a" && (
                    <span className="text-[var(--text-muted)]">· {player.chanceNext}% chance next GW</span>
                  )}
                </span>
              ) : (
                <span className="rounded-full bg-black/40 px-3 py-1 text-[var(--text-muted)]">
                  {player.inCurrentSeason ? "FPL status not available" : "Not registered in FPL this season"}
                </span>
              )}
              <FormBadge label={f?.label} reasons={f?.reasons} pointsPerMatch={f?.last4Ppm} />
            </div>
            {player.news && (
              <p className="mt-2 max-w-prose text-sm text-amber-300">
                {player.news}
                {player.statusAt && <span className="text-xs text-[var(--text-muted)]"> · per {formatWIB(player.statusAt)}</span>}
              </p>
            )}
          </div>

          {f && f.reasons.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">Why the form looks like this</p>
              <ul className="flex flex-col gap-1 text-sm">
                {f.reasons.map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-black/40 p-3">
                <dt className="text-xs text-[var(--text-muted)]">{s.label}</dt>
                <dd className="mt-1 font-display text-3xl leading-none tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="order-first flex items-end justify-center md:order-none">
          <div className="relative">
            <div aria-hidden="true" className="absolute inset-x-6 bottom-0 h-1/2 rounded-full bg-[var(--accent)] opacity-30 blur-3xl" />
            <PlayerHeadshot name={player.webName} urls={player.photosLarge} size="xl" status={player.status} />
          </div>
        </div>
      </div>
    </section>
  );
}
