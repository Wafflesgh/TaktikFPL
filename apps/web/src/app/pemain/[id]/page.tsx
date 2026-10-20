import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon } from "@/components/icons";
import { PlayerHero } from "@/components/player/PlayerHero";
import { PointsChart } from "@/components/player/PointsChart";
import { GwTable, SeasonTable } from "@/components/player/StatTables";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { Panel, StatTile } from "@/components/ui";
import { getPlayerProfile, parsePlayerId } from "@/lib/data/player";
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
  const { player, gws, bars, lastFour, seasons, thisSeason, seasonLabel, liveCount } = profile;
  const f = player.form;
  const pct = (v: number | null | undefined) => (v != null ? `${Math.round(v * 100)}%` : "-");
  const signed = (v: number | null | undefined) => (v != null ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : "-");

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={viewer.displayName} isAdmin={viewer.isAdmin} liveCount={liveCount} />

      <main className="flex min-w-0 flex-col gap-6">
        <Link href="/" className="inline-flex w-fit items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          <ArrowRightIcon size={16} className="rotate-180" />
          Beranda
        </Link>

        <PlayerHero player={player} season={thisSeason} seasonLabel={seasonLabel} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Panel
            className="min-w-0 lg:col-span-8"
            title="Poin per GW"
            subtitle={seasonLabel ? `Musim ${seasonLabel} · DGW dijumlah · arahkan kursor/ketuk batang untuk detail` : undefined}
            action={
              <span className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" />4 GW terakhir
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-white/30" />GW lain
                </span>
              </span>
            }
          >
            <PointsChart bars={bars} highlight={lastFour} />
          </Panel>

          <Panel className="min-w-0 lg:col-span-4" title="Form 4 Laga" subtitle="Dihitung worker (build_form) vs pemain seposisi">
            {f ? (
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Skor form" value={pct(f.score)} hint="persentil seposisi" />
                <StatTile label="Poin/laga" value={f.last4Ppm?.toFixed(1) ?? "-"} hint={`musim: ${f.seasonPpm?.toFixed(1) ?? "-"}`} />
                <StatTile label="xGI/90" value={f.last4Xgi90?.toFixed(2) ?? "-"} hint="4 laga, ter-shrink" />
                <StatTile label="Porsi menit" value={pct(f.minutesShare)} hint="dari menit tersedia" />
                <div className="col-span-2">
                  <StatTile label="Gol − xG" value={signed(f.goalsMinusXg)} hint="positif = finishing di atas ekspektasi" />
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Belum ada data form untuk pemain ini.</p>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel
            className="min-w-0"
            title="Laga Musim Ini"
            subtitle="Terbaru di atas · baris berwarna = 4 GW terakhir · * = poin belum final"
          >
            <GwTable rows={gws} highlight={lastFour} />
          </Panel>
          <Panel className="min-w-0" title="Riwayat Musim" subtitle="Sejak 2016/17 · xGI tersedia mulai 2022/23">
            <SeasonTable rows={seasons} />
          </Panel>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
