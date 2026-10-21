import Link from "next/link";
import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { TeamBadge } from "@/components/ui";
import type { PlayerRow } from "@/lib/data/dashboard";
import { formatPrice } from "@/lib/time";

/** Hero tengah (ref-02): pemain dengan form terbaik + angka form utama. */
export function Spotlight({ player }: { player: PlayerRow | null }) {
  if (!player) {
    return (
      <section className="glass grid min-h-[340px] place-items-center p-8 text-center text-[var(--text-muted)]">
        Form data not available yet — run the <code>sync_player_history</code> dan <code>build_form</code> jobs in the worker.
      </section>
    );
  }
  const f = player.form;
  const stats = [
    { label: "Pts/match (last 4)", value: f?.last4Ppm?.toFixed(1) ?? "-" },
    { label: "Pts/match season", value: f?.seasonPpm?.toFixed(1) ?? "-" },
    { label: "xGI per 90", value: f?.last4Xgi90?.toFixed(2) ?? "-" },
    { label: "Minutes share", value: f?.minutesShare != null ? `${Math.round(f.minutesShare * 100)}%` : "-" },
  ];
  return (
    <section className="glass relative overflow-hidden p-0">
      {/* Latar: glow aksen + garis lapangan (tanpa aset foto stadion di repo) */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 90% at 70% 40%, var(--accent-soft), transparent 70%), linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.55))",
        }}
      />
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full opacity-[0.07]" viewBox="0 0 400 200" preserveAspectRatio="none">
        <rect x="10" y="10" width="380" height="180" fill="none" stroke="white" strokeWidth="1.5" />
        <line x1="200" y1="10" x2="200" y2="190" stroke="white" strokeWidth="1.5" />
        <circle cx="200" cy="100" r="30" fill="none" stroke="white" strokeWidth="1.5" />
        <rect x="10" y="60" width="50" height="80" fill="none" stroke="white" strokeWidth="1.5" />
        <rect x="340" y="60" width="50" height="80" fill="none" stroke="white" strokeWidth="1.5" />
      </svg>

      <div className="relative grid gap-6 p-6 md:grid-cols-[1.1fr_1fr] md:p-8">
        <div className="flex flex-col justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Form spotlight · last 4 matches
            </p>
            <h2 className="mt-2 font-display text-5xl uppercase leading-none xl:text-6xl">
              <Link href={`/pemain/${player.id}`} className="hover:text-[var(--accent)]">
                {player.webName}
              </Link>
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <TeamBadge url={player.team?.badge ?? null} short={player.team?.short ?? null} size={28} />
              <span>{player.team?.name}</span>
              <span className="text-[var(--text-muted)]">·</span>
              <span>{player.position}</span>
              <span className="text-[var(--text-muted)]">·</span>
              <span>{formatPrice(player.priceTenths)}</span>
              <span className="text-[var(--text-muted)]">·</span>
              <span>{player.ownedPct ?? 0}% owned</span>
              <FormBadge label={f?.label} reasons={f?.reasons} pointsPerMatch={f?.last4Ppm} />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-black/40 p-3">
                <dt className="text-xs text-[var(--text-muted)]">{s.label}</dt>
                <dd className="mt-1 font-display text-3xl leading-none">{s.value}</dd>
              </div>
            ))}
          </dl>

          {f && f.reasons.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {f.reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-end justify-center">
          <div className="relative">
            <div aria-hidden="true" className="absolute inset-x-6 bottom-0 h-1/2 rounded-full bg-[var(--accent)] opacity-30 blur-3xl" />
            <PlayerHeadshot name={player.webName} urls={player.photosLarge} size="xl" status={player.status} />
          </div>
        </div>
      </div>
    </section>
  );
}
