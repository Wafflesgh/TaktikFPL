import Link from "next/link";
import { FormBadge } from "@/components/FormBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { playerPhotoUrls } from "@/lib/assets";
import { FORM_ORDER } from "@/lib/form";
import { createClient } from "@/lib/supabase/server";
import { countdown, formatDayWIB, formatPrice, formatTimeWIB, formatWIB } from "@/lib/time";

const POSITIONS = ["GKP", "DEF", "MID", "FWD"] as const;
const SORTS = { form: "Form", price: "Harga", owned: "Kepemilikan" } as const;
type Sort = keyof typeof SORTS;

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const pos = POSITIONS.find((p) => p === pick(params.pos));
  const sort: Sort = (Object.keys(SORTS) as Sort[]).find((s) => s === pick(params.sort)) ?? "form";

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();

  let playersQuery = supabase
    .from("v_player_current")
    .select("id, web_name, full_name, fpl_code, photo_url_resolved, team_short_name, fpl_position, status, chance_next, news, price_tenths, selected_by_pct");
  if (pos) playersQuery = playersQuery.eq("fpl_position", pos);

  const [{ data: gws }, { data: fixtures }, { data: players }, { data: forms }] = await Promise.all([
    supabase.from("gameweeks").select("number, deadline_utc, is_current, is_next, is_blank, is_double").or("is_current.eq.true,is_next.eq.true"),
    supabase.from("v_next_gw_fixtures").select("id, gw, home, away, kickoff_utc, status, difficulty_home, difficulty_away, recently_changed").order("kickoff_utc"),
    playersQuery.order("price_tenths", { ascending: false }).limit(1000),
    supabase.from("v_player_form").select("player_id, form_label, form_score, form_reasons, last4_points_per_match, last4_xgi90, season_points_per_match"),
  ]);

  const next = gws?.find((g) => g.is_next);
  const formById = new Map((forms ?? []).map((f) => [f.player_id, f]));
  const rows = (players ?? []).map((p) => ({ ...p, form: formById.get(p.id) }));
  rows.sort((a, b) => {
    if (sort === "price") return (b.price_tenths ?? 0) - (a.price_tenths ?? 0);
    if (sort === "owned") return (b.selected_by_pct ?? 0) - (a.selected_by_pct ?? 0);
    const ra = FORM_ORDER.indexOf(a.form?.form_label ?? "minim_menit");
    const rb = FORM_ORDER.indexOf(b.form?.form_label ?? "minim_menit");
    return ra - rb || (b.form?.form_score ?? 0) - (a.form?.form_score ?? 0);
  });
  const shown = rows.slice(0, 80);

  const byDay = new Map<string, NonNullable<typeof fixtures>>();
  for (const f of fixtures ?? []) {
    const key = f.kickoff_utc ? formatDayWIB(f.kickoff_utc) : "Belum dijadwalkan";
    byDay.set(key, [...(byDay.get(key) ?? []), f]);
  }

  const qs = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { pos, sort, ...patch };
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) s.set(k, v);
    return `/?${s.toString()}`;
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--text-muted)]">Halo, {(claims?.claims?.email as string | undefined)?.split("@")[0] ?? "Manajer"} 👋</p>
          <h1 className="font-display text-4xl uppercase md:text-5xl">TaktikFPL</h1>
          {next ? (
            <p className="mt-1 text-sm">
              GW{next.number} · Deadline {formatWIB(next.deadline_utc)} ·{" "}
              <span className="font-semibold text-[var(--accent)]">⏳ {countdown(next.deadline_utc)}</span>
              {next.is_double ? " · Double GW" : ""}
              {next.is_blank ? " · Blank GW" : ""}
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--text-muted)]">Data gameweek belum tersedia — jalankan sync_bootstrap di worker.</p>
          )}
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/admin/health" className="glass px-4 py-2">Admin</Link>
          <form action="/auth/signout" method="post">
            <button className="glass px-4 py-2" type="submit">Keluar</button>
          </form>
        </nav>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="glass p-4">
          <h2 className="mb-3 font-display text-xl uppercase">Jadwal GW{next?.number ?? ""}</h2>
          {byDay.size === 0 && <p className="text-sm text-[var(--text-muted)]">Belum ada fixture.</p>}
          <div className="flex flex-col gap-4">
            {[...byDay.entries()].map(([day, list]) => (
              <div key={day}>
                <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">{day}</p>
                <ul className="flex flex-col gap-1">
                  {list.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                      <span className="font-semibold">
                        {f.home} <span className="text-[var(--text-muted)]">vs</span> {f.away}
                      </span>
                      <span className="flex items-center gap-2">
                        {f.recently_changed && (
                          <span className="rounded-full bg-[var(--status-doubt)]/20 px-2 py-0.5 text-xs text-amber-300" title="Jadwal berubah dalam 7 hari terakhir">
                            ⚠ Jadwal berubah
                          </span>
                        )}
                        <span className="tabular-nums">{formatTimeWIB(f.kickoff_utc)}</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          FDR {f.difficulty_home ?? "-"}|{f.difficulty_away ?? "-"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="glass p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl uppercase">Pemain</h2>
            <div className="flex flex-wrap gap-1 text-xs">
              <Link href={qs({ pos: undefined })} className={`rounded-full px-3 py-1 ${!pos ? "bg-[var(--accent)]" : "bg-white/10"}`}>Semua</Link>
              {POSITIONS.map((p) => (
                <Link key={p} href={qs({ pos: p })} className={`rounded-full px-3 py-1 ${pos === p ? "bg-[var(--accent)]" : "bg-white/10"}`}>{p}</Link>
              ))}
              <span className="mx-1 text-[var(--text-muted)]">·</span>
              {(Object.keys(SORTS) as Sort[]).map((s) => (
                <Link key={s} href={qs({ sort: s })} className={`rounded-full px-3 py-1 ${sort === s ? "bg-white/25" : "bg-white/5"}`}>{SORTS[s]}</Link>
              ))}
            </div>
          </div>
          {shown.length === 0 && <p className="text-sm text-[var(--text-muted)]">Belum ada data pemain.</p>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {shown.map((p) => {
              const reasons = Array.isArray(p.form?.form_reasons) ? (p.form.form_reasons as string[]) : [];
              return (
                <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-2 pr-3">
                  <PlayerHeadshot name={p.web_name ?? "?"} urls={playerPhotoUrls(p.fpl_code, p.photo_url_resolved)} status={p.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.web_name}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      {p.team_short_name} · {p.fpl_position} · {formatPrice(p.price_tenths)} · {p.selected_by_pct ?? 0}%
                    </p>
                    {p.news && <p className="truncate text-xs text-amber-300" title={p.news}>{p.news}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <FormBadge label={p.form?.form_label} reasons={reasons} pointsPerMatch={p.form?.last4_points_per_match} />
                    {p.form?.last4_points_per_match != null && (
                      <span className="text-xs tabular-nums text-[var(--text-muted)]" title="Poin per laga: 4 laga terakhir / musim">
                        {Number(p.form.last4_points_per_match).toFixed(1)} / {Number(p.form.season_points_per_match ?? 0).toFixed(1)} pts
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
