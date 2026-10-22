import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Insights } from "@/components/analysis/Insights";
import { SquadTable } from "@/components/club/SquadTable";
import { XiPitch } from "@/components/club/XiPitch";
import { ArrowRightIcon } from "@/components/icons";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { FdrChip, Panel, StatTile, TeamBadge } from "@/components/ui";
import { tacticsInsights } from "@/lib/analysis/coach";
import { ordinal } from "@/lib/analysis/types";
import { getClub, type ClubData } from "@/lib/data/club";
import type { TeamInfo } from "@/lib/data/dashboard";
import type { TeamRow } from "@/lib/data/league";
import { parsePlayerId } from "@/lib/data/player";
import { getSquadStats } from "@/lib/data/squad";
import { getViewer } from "@/lib/data/viewer";
import { formatDateWIB, formatWIB } from "@/lib/time";

async function load(params: PageProps<"/klub/[id]">["params"]) {
  const id = parsePlayerId((await params).id);
  if (id == null) notFound();
  const club = await getClub(id);
  if (!club) notFound();
  return club;
}

export async function generateMetadata({ params }: PageProps<"/klub/[id]">): Promise<Metadata> {
  const { team } = await load(params);
  return { title: `${team.name} · TaktikFPL` };
}

const RESULT_BG = { W: "bg-[var(--status-ok)] text-black", D: "bg-white/25", L: "bg-[var(--status-out)]" } as const;
const n2 = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(2));

/** Profil klub: XI utama & taktik pelatih, rekor musim, jadwal, dan review laga terakhir. */
export default async function ClubPage({ params }: PageProps<"/klub/[id]">) {
  const [club, viewer] = await Promise.all([load(params), getViewer()]);
  const squad = await getSquadStats(club.team.id, club.seasonId);
  const { team, style, record: rec, xi, shotProfile: sp } = club;
  const form = club.last.slice(0, 5).reverse();
  const tactics = tacticsInsights({
    teamName: team.name,
    style,
    formationUsage: xi?.usage ?? [],
    sample: xi?.sample ?? 0,
    setPieceShareFor: sp.setPieceShareFor,
    setPieceShareAgainst: sp.setPieceShareAgainst,
    crossShareFor: sp.crossShareFor,
    xgPerShot: sp.xgPerShot,
    xgPerShotAgainst: sp.xgPerShotAgainst,
  });

  return (
    <div className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={viewer.displayName} isAdmin={viewer.isAdmin} liveCount={0} />
      <main className="flex min-w-0 flex-col gap-6">
        <Link href="/" className="inline-flex w-fit items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          <ArrowRightIcon size={16} className="rotate-180" />
          Home
        </Link>

        <section className="glass flex flex-wrap items-center gap-5 rounded-3xl p-5">
          <TeamBadge url={team.badge} short={team.short} size={72} />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Club profile · {club.seasonLabel}</p>
            <h1 className="font-display text-3xl">{team.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
              {club.tablePos != null && <span className="font-semibold text-[var(--text)]">{ordinal(club.tablePos)} in the table</span>}
              <span>
                · {rec.won}W {rec.drawn}D {rec.lost}L · {rec.points} pts
              </span>
              <span className="flex gap-1" aria-label="Last 5 results, oldest first">
                {form.map(({ row }) => (
                  <span key={row.fx.id} className={`grid h-5 w-5 place-items-center rounded text-[10px] font-bold ${RESULT_BG[row.result!]}`}>
                    {row.result}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <StatTile label="xG / match" value={rec.played && rec.xg != null ? (rec.xg / rec.played).toFixed(2) : "-"} hint={style ? `${ordinal(style.rankAttack)} of ${style.n}` : undefined} />
            <StatTile label="xGA / match" value={rec.played && rec.xga != null ? (rec.xga / rec.played).toFixed(2) : "-"} hint={style ? `${ordinal(style.rankDefence)} best` : undefined} />
            <StatTile label="PPDA" value={rec.ppda?.toFixed(1) ?? "-"} hint={style ? style.bucket.replace("_", " ") : undefined} />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Panel
            className="min-w-0 lg:col-span-5"
            title="Usual XI"
            subtitle={xi ? `Most-used starters by position · last ${xi.sample} league matches · ${xi.formation ?? "?"}` : undefined}
          >
            {xi && xi.players.length ? <XiPitch xi={xi} cards={club.xiCards} /> : <p className="text-sm text-[var(--text-muted)]">No lineup data yet.</p>}
          </Panel>
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
            <Panel title="How they play" subtitle="Derived from lineups (shape), PPDA (press), deep completions (territory) and shot data — not opinion">
              <Insights items={tactics} />
            </Panel>
            <Panel title="Head coach" subtitle="Source: Wikidata · record from TaktikFPL fixtures">
              <CoachCard club={club} />
            </Panel>
          </div>
        </div>

        <Panel title="Squad" subtitle={`${squad.length} players · ${club.seasonLabel} totals · click a player for the full profile`}>
          {squad.length ? <SquadTable players={squad} /> : <p className="text-sm text-[var(--text-muted)]">No squad data yet.</p>}
        </Panel>

        <Panel title="Season overview" subtitle={`${club.seasonLabel} · overall, home and away`}>
          <Overview club={club} />
        </Panel>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel className="min-w-0" title="Next matches" subtitle="Official FPL difficulty · times in WIB">
            <MatchTable rows={club.upcoming.slice(0, 10)} upcoming />
          </Panel>
          <Panel className="min-w-0" title="Last matches" subtitle="Newest first · xG from Understat">
            <MatchTable rows={club.last.slice(0, 10)} />
          </Panel>
        </div>

        <Panel title="Match reviews" subtitle="Why each recent result happened — fundamental (opponent, absences, cards, venue) and technical (chances, block, territory, set pieces, game state)">
          <div className="flex flex-col gap-3">
            {club.reviews.length === 0 && <p className="text-sm text-[var(--text-muted)]">No finished matches yet.</p>}
            {club.reviews.map(({ row, opp, review }, i) => (
              <details key={row.fx.id} open={i === 0} className="rounded-2xl border border-[var(--glass-border)] bg-white/[0.03] open:bg-white/[0.05]">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
                  <span className={`grid h-7 w-7 place-items-center rounded-md text-xs font-bold ${RESULT_BG[row.result!]}`}>{row.result}</span>
                  <span className="text-xs text-[var(--text-muted)] tabular-nums">GW{row.fx.gw}</span>
                  <TeamBadge url={opp.badge} short={opp.short} size={24} />
                  <span className="font-semibold">
                    {row.gf}–{row.ga} {row.home ? "vs" : "at"}{" "}
                    <Link href={`/klub/${opp.id}`} className="hover:text-[var(--accent)]">
                      {opp.name}
                    </Link>
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium">{review.verdict}</span>
                  <span className="text-sm text-[var(--text-muted)]">{review.headline}</span>
                </summary>
                <div className="border-t border-white/5 px-4 py-3">
                  <Insights items={review.insights} />
                </div>
              </details>
            ))}
          </div>
        </Panel>
      </main>
      <BottomNav />
    </div>
  );
}

function CoachCard({ club }: { club: ClubData }) {
  const c = club.coach;
  if (!c) return <p className="text-sm text-[var(--text-muted)]">Coach data not synced yet (job sync_managers).</p>;
  const r = c.record;
  return (
    <div className="flex flex-wrap items-start gap-4">
      {c.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto dari CDN Wikimedia Commons
        <img src={c.photoUrl} alt={c.name} className="h-16 w-16 rounded-full object-cover object-top ring-1 ring-white/20" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="grid h-16 w-16 place-items-center rounded-full bg-white/10 text-lg font-bold">{c.name.slice(0, 1)}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{c.name}</p>
        <p className="text-xs text-[var(--text-muted)]">
          {[c.nationality, c.age != null ? `${c.age} years old` : null, `in charge since ${formatDateWIB(c.since)}`].filter(Boolean).join(" · ")}
        </p>
        <table className="mt-2 text-sm">
          <tbody>
            <tr>
              <td className="pr-3 text-[var(--text-muted)]">Record</td>
              <td className="tabular-nums">
                {r.played} played · {r.won}W {r.drawn}D {r.lost}L · {r.ppg?.toFixed(2) ?? "-"} pts/match
              </td>
            </tr>
            <tr>
              <td className="pr-3 text-[var(--text-muted)]">xG / xGA</td>
              <td className="tabular-nums">
                {n2(r.xgFor)} / {n2(r.xgAgainst)} per match
              </td>
            </tr>
            {c.predecessor && (
              <tr>
                <td className="pr-3 text-[var(--text-muted)]">Before</td>
                <td className="tabular-nums">
                  {c.predecessor.name}: {c.predecessor.ppg?.toFixed(2) ?? "-"} pts/match ({c.predecessor.played} matches in our data)
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {c.wikidataUrl && (
          <a href={c.wikidataUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--text-muted)] hover:text-[var(--accent)]">
            Wikidata ↗
          </a>
        )}
      </div>
    </div>
  );
}

function Overview({ club }: { club: ClubData }) {
  const r = club.record;
  const sp = club.shotProfile;
  const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);
  const line = (label: string, s: { played: number; points: number; gf: number; ga: number }) => (
    <tr className="border-t border-white/5">
      <td className="py-1.5">{label}</td>
      <td className="text-right tabular-nums">{s.played}</td>
      <td className="text-right tabular-nums">{s.points}</td>
      <td className="text-right tabular-nums">{s.played ? (s.points / s.played).toFixed(2) : "-"}</td>
      <td className="text-right tabular-nums">{s.gf}</td>
      <td className="text-right tabular-nums">{s.ga}</td>
      <td className="text-right tabular-nums">{s.gf - s.ga > 0 ? "+" : ""}{s.gf - s.ga}</td>
    </tr>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <table className="w-full text-sm">
        <thead className="text-xs text-[var(--text-muted)]">
          <tr>
            <th className="py-1 text-left font-normal" />
            <th className="text-right font-normal">P</th>
            <th className="text-right font-normal">Pts</th>
            <th className="text-right font-normal">Pts/m</th>
            <th className="text-right font-normal">GF</th>
            <th className="text-right font-normal">GA</th>
            <th className="text-right font-normal">GD</th>
          </tr>
        </thead>
        <tbody>
          {line("Overall", r)}
          {line("Home", r.home)}
          {line("Away", r.away)}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <StatTile label="Clean sheets" value={r.cleanSheets} />
        <StatTile label="xG − goals" value={r.xg != null ? (r.gf - r.xg).toFixed(1) : "-"} hint="+ = finishing above xG" />
        <StatTile label="xGA − conceded" value={r.xga != null ? (r.xga - r.ga).toFixed(1) : "-"} hint="+ = conceding below xG" />
        <StatTile label="Shots / match" value={sp.matches ? (sp.shotsFor / sp.matches).toFixed(1) : "-"} hint={`allowed ${sp.matches ? (sp.shotsAgainst / sp.matches).toFixed(1) : "-"}`} />
        <StatTile label="xG / shot" value={n2(sp.xgPerShot)} hint={`allowed ${n2(sp.xgPerShotAgainst)}`} />
        <StatTile label="Set-piece xG" value={pct(sp.setPieceShareFor)} hint={`of xG · allowed ${pct(sp.setPieceShareAgainst)}`} />
        <StatTile label="Shots from crosses" value={pct(sp.crossShareFor)} />
        <StatTile label="Table" value={club.tablePos != null ? ordinal(club.tablePos) : "-"} hint={`of ${club.standings.length}`} />
      </div>
    </div>
  );
}

function MatchTable({ rows, upcoming = false }: { rows: { row: TeamRow; opp: TeamInfo; oppPos: number | null }[]; upcoming?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">{upcoming ? "No upcoming matches." : "No matches yet."}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-sm">
        <thead className="text-xs text-[var(--text-muted)]">
          <tr>
            <th className="py-1 text-left font-normal">GW</th>
            <th className="text-left font-normal">Opponent</th>
            <th className="text-center font-normal">H/A</th>
            {upcoming ? (
              <>
                <th className="text-left font-normal">Kick-off (WIB)</th>
                <th className="text-right font-normal">FDR</th>
              </>
            ) : (
              <>
                <th className="text-center font-normal">Result</th>
                <th className="text-right font-normal">xG</th>
                <th className="text-right font-normal">xGA</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, opp, oppPos }) => (
            <tr key={row.fx.id} className="border-t border-white/5">
              <td className="py-1.5 tabular-nums">{row.fx.gw ?? "-"}</td>
              <td>
                <Link href={`/klub/${opp.id}`} className="flex items-center gap-2 hover:text-[var(--accent)]">
                  <TeamBadge url={opp.badge} short={opp.short} size={22} />
                  {opp.name}
                  {oppPos != null && <span className="text-xs text-[var(--text-muted)]">({ordinal(oppPos)})</span>}
                </Link>
              </td>
              <td className="text-center text-[var(--text-muted)]">{row.home ? "H" : "A"}</td>
              {upcoming ? (
                <>
                  <td className="text-[var(--text-muted)]">{formatWIB(row.fx.kickoffUtc)}</td>
                  <td className="text-right">
                    <FdrChip value={row.fdr} />
                  </td>
                </>
              ) : (
                <>
                  <td className="text-center">
                    <span className={`inline-block rounded px-1.5 text-xs font-bold ${RESULT_BG[row.result!]}`}>
                      {row.result} {row.gf}–{row.ga}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{n2(row.stat?.xg)}</td>
                  <td className="text-right tabular-nums">{n2(row.stat?.xga)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
