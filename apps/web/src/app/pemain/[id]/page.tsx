import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon } from "@/components/icons";
import { DetailedStats } from "@/components/player/DetailedStats";
import { PeerTable } from "@/components/player/PeerTable";
import { PlayerHero } from "@/components/player/PlayerHero";
import { PointsChart } from "@/components/player/PointsChart";
import { PositionMap } from "@/components/player/PositionMap";
import { GwTable, SeasonTable } from "@/components/player/StatTables";
import { TacticalProfile } from "@/components/player/TacticalProfile";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { Panel, StatTile } from "@/components/ui";
import { getPlayerProfile, parsePlayerId } from "@/lib/data/player";
import { getPlayerPositions, getPositionPeers, getSeasonDetail } from "@/lib/data/playerDetail";
import { getPlayerTactics } from "@/lib/data/tactics";
import { getViewer } from "@/lib/data/viewer";

async function load(params: PageProps<"/pemain/[id]">["params"]) {
  const id = parsePlayerId((await params).id);
  if (id == null) notFound();
  const profile = await getPlayerProfile(id);
  if (!profile) notFound();
  return profile;
}

export async function generateMetadata({ params }: PageProps<"/pemain/[id]">): Promise<Metadata> {
  const { player } = await load(params);
  return { title: `${player.webName} · TaktikFPL` };
}

/** Profil pemain desktop-first (wireframe B): hero · grafik poin + form · laga musim ini + riwayat musim. */
export default async function PlayerPage({ params }: PageProps<"/pemain/[id]">) {
  const [profile, viewer] = await Promise.all([load(params), getViewer()]);
  const { player, gws, bars, lastFour, seasons, thisSeason, seasonLabel, seasonId, liveCount } = profile;
  const [tactics, positions, peers, detail] = await Promise.all([
    getPlayerTactics(player.id),
    getPlayerPositions(player.id),
    player.position ? getPositionPeers(player.position) : Promise.resolve([]),
    seasonId != null ? getSeasonDetail(player.id, seasonId) : Promise.resolve(null),
  ]);
  const f = player.form;
  const pct = (v: number | null | undefined) => (v != null ? `${Math.round(v * 100)}%` : "-");
  const signed = (v: number | null | undefined) => (v != null ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : "-");

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={viewer.displayName} isAdmin={viewer.isAdmin} liveCount={liveCount} />

      <main className="flex min-w-0 flex-col gap-6">
        <Link href="/" className="inline-flex w-fit items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          <ArrowRightIcon size={16} className="rotate-180" />
          Home
        </Link>

        <PlayerHero player={player} season={thisSeason} seasonLabel={seasonLabel} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Panel
            className="min-w-0 lg:col-span-8"
            title="Points per GW"
            subtitle={seasonLabel ? `Season ${seasonLabel} · DGWs summed · hover/tap a bar for details` : undefined}
            action={
              <span className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" />Last 4 GWs
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-white/30" />Other GWs
                </span>
              </span>
            }
          >
            <PointsChart bars={bars} highlight={lastFour} />
          </Panel>

          <Panel className="min-w-0 lg:col-span-4" title="Form (last 4)" subtitle="Computed by the worker (build_form) vs same-position players">
            {f ? (
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Form score" value={pct(f.score)} hint="percentile within position" />
                <StatTile label="Pts/match" value={f.last4Ppm?.toFixed(1) ?? "-"} hint={`season: ${f.seasonPpm?.toFixed(1) ?? "-"}`} />
                <StatTile label="xGI/90" value={f.last4Xgi90?.toFixed(2) ?? "-"} hint="last 4, shrunk" />
                <StatTile label="Minutes share" value={pct(f.minutesShare)} hint="of available minutes" />
                <div className="col-span-2">
                  <StatTile label="Goals − xG" value={signed(f.goalsMinusXg)} hint="positive = finishing above expectation" />
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No form data for this player yet.</p>
            )}
          </Panel>
        </div>

        <Panel
          title="Positions played"
          subtitle="Each circle is a position the player has played (size = share of appearances) · tap a circle or row for details"
        >
          <PositionMap seasons={positions} currentLabel={seasonLabel} />
        </Panel>

        {detail && detail.matches > 0 && (
          <Panel title="Detailed stats" subtitle={seasonLabel ? `Season ${seasonLabel} · totals, per 90 and percentile vs same position` : undefined}>
            <DetailedStats detail={detail} peers={peers} playerId={player.id} position={player.position} />
          </Panel>
        )}

        {player.position && peers.length > 0 && (
          <Panel title={`Compare with other ${player.position}s`} subtitle="Same FPL position · season totals and last-4 form · this player highlighted">
            <PeerTable peers={peers} playerId={player.id} position={player.position} />
          </Panel>
        )}

        <TacticalProfile data={tactics} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel
            className="min-w-0"
            title="This Season's Matches"
            subtitle="Newest first · highlighted rows = last 4 GWs · * = points not final"
          >
            <GwTable rows={gws} highlight={lastFour} />
          </Panel>
          <Panel className="min-w-0" title="Season History" subtitle="Since 2016/17 · xGI available from 2022/23">
            <SeasonTable rows={seasons} />
          </Panel>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
