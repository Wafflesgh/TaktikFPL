import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { DeadlineTile } from "@/components/dashboard/DeadlineTile";
import { FixtureGrid, NextMatchCard, StandingsTable } from "@/components/dashboard/Matches";
import { FormLeaders, PlayerTable, type Sort } from "@/components/dashboard/Players";
import { Spotlight } from "@/components/dashboard/Spotlight";
import { AlertIcon, CalendarIcon, ClockIcon, FlameIcon } from "@/components/icons";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { Panel, StatTile } from "@/components/ui";
import type { DashboardData, PlayerRow } from "@/lib/data/dashboard";
import { FORM_ORDER } from "@/lib/form";
import { formatWIB } from "@/lib/time";

const formRank = (p: PlayerRow) => FORM_ORDER.indexOf(p.form?.label ?? "minim_menit");

export function sortPlayers(players: PlayerRow[], sort: Sort): PlayerRow[] {
  return [...players].sort((a, b) => {
    if (sort === "price") return (b.priceTenths ?? 0) - (a.priceTenths ?? 0);
    if (sort === "owned") return (b.ownedPct ?? 0) - (a.ownedPct ?? 0);
    if (sort === "xgi") return (b.form?.last4Xgi90 ?? -1) - (a.form?.last4Xgi90 ?? -1);
    return formRank(a) - formRank(b) || (b.form?.score ?? 0) - (a.form?.score ?? 0);
  });
}

type Props = {
  displayName: string;
  isAdmin: boolean;
  data: DashboardData;
  pos: string | undefined;
  sort: Sort;
};

/** Beranda desktop-first (ref-02): top bar + 3 kolom; mobile: kolom bertumpuk + bottom nav. */
export function DashboardView({ displayName, isAdmin, data, pos, sort }: Props) {
  const { next, fixtures, live, players, standings, fetchedAt } = data;

  const byForm = sortPlayers(players, "form");
  const spotlight = byForm.find((p) => p.form?.label === "panas" || p.form?.label === "bagus") ?? null;
  const leaders = byForm.filter((p) => p.form?.label && p.form.label !== "minim_menit").slice(0, 6);
  const hotCount = players.filter((p) => p.form?.label === "panas").length;
  const changedCount = fixtures.filter((f) => f.recentlyChanged).length;
  const flagged = players.filter((p) => p.status && p.status !== "a" && (p.ownedPct ?? 0) >= 5).slice(0, 4);

  const filtered = sortPlayers(pos ? players.filter((p) => p.position === pos) : players, sort).slice(0, 60);
  const hrefFor = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { pos, sort, ...patch };
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) s.set(k, v);
    return `/?${s.toString()}`;
  };
  const upcoming = fixtures.find((f) => f.kickoffUtc && new Date(f.kickoffUtc) > new Date()) ?? fixtures[0] ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={displayName} isAdmin={isAdmin} liveCount={live.length} />

      <main className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Kolom kiri: overview GW */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-4 xl:col-span-3">
          <Panel
            title={next ? `GW${next.number} Overview` : "Overview"}
            subtitle={next ? `Deadline ${formatWIB(next.deadline_utc)}` : "Data gameweek belum tersedia"}
          >
            {spotlight && (
              <div className="mb-3 flex items-center gap-3 rounded-2xl bg-[var(--accent-soft)] p-3">
                <PlayerHeadshot name={spotlight.webName} urls={spotlight.photos} size="md" status={spotlight.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[var(--text-muted)]">Pemain terpanas</p>
                  <p className="truncate font-semibold">{spotlight.webName}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {spotlight.team?.short} · {spotlight.position}
                  </p>
                </div>
                <span className="grid h-12 w-12 place-items-center rounded-full bg-black/40 font-display text-xl" title="Poin per laga, 4 laga terakhir">
                  {spotlight.form?.last4Ppm?.toFixed(1) ?? "-"}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {next ? (
                <DeadlineTile deadlineUtc={next.deadline_utc} serverNow={fetchedAt} />
              ) : (
                <StatTile label="Deadline" icon={<ClockIcon size={16} />} value="-" />
              )}
              <StatTile
                label="Laga GW"
                icon={<CalendarIcon size={16} />}
                value={fixtures.length}
                hint={next?.is_double ? "Double GW" : next?.is_blank ? "Blank GW" : "GW normal"}
              />
              <StatTile label="Form panas" icon={<FlameIcon size={16} />} value={hotCount} hint="pemain, 4 laga terakhir" />
              <StatTile
                label="Jadwal berubah"
                icon={<AlertIcon size={16} />}
                value={changedCount}
                hint="7 hari terakhir"
                tone={changedCount > 0 ? "warn" : "default"}
              />
            </div>
          </Panel>

          <FormLeaders players={leaders} />

          {flagged.length > 0 && (
            <Panel title="Perlu Diwaspadai" subtitle="Pemain populer (≥5% owned) dengan status tidak fit">
              <ul className="flex flex-col gap-3">
                {flagged.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 text-sm">
                    <PlayerHeadshot name={p.webName} urls={p.photos} size="sm" status={p.status} />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {p.webName} <span className="text-xs text-[var(--text-muted)]">{p.team?.short}</span>
                      </p>
                      <p className="text-xs text-amber-300">{p.news ?? "Status diragukan"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        {/* Kolom tengah: hero + jadwal + pemain */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8 xl:col-span-6">
          <Spotlight player={spotlight} />
          <Panel
            title={next ? `Jadwal GW${next.number}` : "Jadwal"}
            subtitle="Waktu kick-off dalam WIB · angka berwarna = FDR"
          >
            <FixtureGrid fixtures={fixtures} />
          </Panel>
          <PlayerTable players={filtered} pos={pos} sort={sort} hrefFor={hrefFor} />
        </div>

        {/* Kolom kanan: laga + klasemen */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-12 lg:grid lg:grid-cols-2 xl:col-span-3 xl:flex">
          <NextMatchCard live={live} next={upcoming} />
          <StandingsTable rows={standings} />
          {spotlight?.form && (
            <Panel title="Catatan Form" subtitle="Cara membaca label">
              <ul className="flex flex-col gap-2 text-xs text-[var(--text-muted)]">
                {["panas", "bagus", "stabil", "menurun", "dingin"].map((l) => (
                  <li key={l} className="flex items-center gap-2">
                    <FormBadge label={l} />
                    <span>
                      {l === "panas" && "15% teratas posisinya & tren tidak turun"}
                      {l === "bagus" && "di atas mayoritas pemain seposisi"}
                      {l === "stabil" && "rata-rata posisinya"}
                      {l === "menurun" && "tren underlying turun ≥15% vs musimnya"}
                      {l === "dingin" && "di bawah mayoritas pemain seposisi"}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
