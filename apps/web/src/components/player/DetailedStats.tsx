import type { Peer, SeasonDetail } from "@/lib/data/playerDetail";

type Row = {
  label: string;
  total: number | null;
  digits?: number;
  /** Bandingkan per 90 dengan pemain se-posisi (≥ MIN_MINUTES) dari snapshot build_form. */
  peer?: (p: NonNullable<Peer["season"]>) => number;
  noPer90?: boolean;
};

const MIN_MINUTES = 270;

function percentile(peers: Peer[], playerId: number, f: NonNullable<Row["peer"]>): number | null {
  const pool = peers.filter((p) => p.season && p.season.minutes >= MIN_MINUTES);
  const me = pool.find((p) => p.id === playerId);
  if (!me?.season || pool.length < 10) return null;
  const v = f(me.season);
  const below = pool.filter((p) => f(p.season!) < v).length;
  const equal = pool.filter((p) => f(p.season!) === v).length;
  return (below + equal / 2) / pool.length;
}

const p90 = (v: number, mins: number) => (mins > 0 ? (v * 90) / mins : 0);

/** Statistik musim berjalan lengkap: total, per 90, dan persentil vs posisi yang sama. */
export function DetailedStats({
  detail,
  peers,
  playerId,
  position,
}: {
  detail: SeasonDetail;
  peers: Peer[];
  playerId: number;
  position: string | null;
}) {
  const f = detail.fpl;
  const u = detail.understat;
  const groups: [string, Row[]][] = [
    [
      "Attack",
      [
        { label: "Goals", total: f.goals_scored, peer: (s) => p90(s.goals, s.minutes) },
        { label: "xG", total: f.expected_goals, digits: 2, peer: (s) => p90(s.xg, s.minutes) },
        { label: "Non-penalty xG", total: u?.npxg ?? null, digits: 2 },
        { label: "Shots", total: u?.shots ?? null },
        { label: "Assists", total: f.assists, peer: (s) => p90(s.assists, s.minutes) },
        { label: "xA", total: f.expected_assists, digits: 2, peer: (s) => p90(s.xa, s.minutes) },
        { label: "Key passes", total: u?.key_passes ?? null },
        { label: "xGChain", total: u?.xg_chain ?? null, digits: 2 },
        { label: "xGBuildup", total: u?.xg_buildup ?? null, digits: 2 },
        { label: "Threat (ICT)", total: f.threat, digits: 0 },
        { label: "Creativity (ICT)", total: f.creativity, digits: 0 },
      ],
    ],
    [
      "FPL",
      [
        { label: "Points", total: f.total_points, peer: (s) => p90(s.points, s.minutes) },
        { label: "Bonus", total: f.bonus, peer: (s) => p90(s.bonus, s.minutes) },
        { label: "BPS", total: f.bps },
        { label: "Influence (ICT)", total: f.influence, digits: 0 },
        { label: "ICT index", total: f.ict_index, digits: 1 },
      ],
    ],
    [
      "Defence",
      [
        { label: "Clean sheets", total: f.clean_sheets, peer: (s) => p90(s.cleanSheets, s.minutes) },
        { label: "Goals conceded", total: f.goals_conceded },
        { label: "xG conceded", total: f.expected_goals_conceded, digits: 2 },
        { label: "Defensive contributions", total: f.defensive_contribution, peer: (s) => s.defcon90 ?? 0 },
        { label: "DefCon points", total: f.defcon_points },
        ...(position === "GKP"
          ? [
              { label: "Saves", total: f.saves },
              { label: "Penalties saved", total: f.penalties_saved, noPer90: true },
            ]
          : []),
      ],
    ],
    [
      "Discipline",
      [
        { label: "Yellow cards", total: f.yellow_cards },
        { label: "Red cards", total: f.red_cards, noPer90: true },
        { label: "Own goals", total: f.own_goals, noPer90: true },
        { label: "Penalties missed", total: f.penalties_missed, noPer90: true },
      ],
    ],
  ];
  const mins = detail.minutes;
  // npxG, tembakan, key pass, xGChain dari Understat → per 90 memakai menit Understat.
  const usMins = u?.minutes ?? mins;
  const fromUnderstat = new Set(["Non-penalty xG", "Shots", "Key passes", "xGChain", "xGBuildup"]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3 text-center text-sm sm:grid-cols-4">
        <Tile label="Matches" value={detail.matches} />
        <Tile label="Appearances" value={detail.appearances} />
        <Tile label="Starts" value={detail.starts} />
        <Tile label="Minutes" value={mins.toLocaleString("en-GB")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map(([title, rows]) => (
          <div key={title} className="min-w-0">
            <p className="mb-1 text-xs uppercase tracking-wider text-[var(--text-muted)]">{title}</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="py-1 text-left font-normal">Stat</th>
                  <th className="text-right font-normal">Total</th>
                  <th className="text-right font-normal">Per 90</th>
                  <th className="w-28 pl-3 text-left font-normal" title={`Percentile per 90 vs ${position ?? "same-position"} players with ${MIN_MINUTES}+ mins`}>
                    vs {position ?? "position"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pm = fromUnderstat.has(r.label) ? usMins : mins;
                  const pc = r.peer ? percentile(peers, playerId, r.peer) : null;
                  return (
                    <tr key={r.label} className="border-t border-white/5">
                      <td className="py-1.5">{r.label}</td>
                      <td className="text-right tabular-nums">{r.total == null ? "-" : r.total.toFixed(r.digits ?? 0)}</td>
                      <td className="text-right tabular-nums text-[var(--text-muted)]">
                        {r.total == null || r.noPer90 || pm <= 0 ? "-" : p90(r.total, pm).toFixed(2)}
                      </td>
                      <td className="pl-3">
                        {pc == null ? (
                          <span className="text-xs text-[var(--text-muted)]">-</span>
                        ) : (
                          <span className="flex items-center gap-2" title={`Better than ${Math.round(pc * 100)}% of ${position}s`}>
                            <span className="h-1.5 flex-1 rounded-full bg-white/10">
                              <span
                                className="block h-1.5 rounded-full"
                                style={{
                                  width: `${Math.round(pc * 100)}%`,
                                  background: pc >= 0.8 ? "var(--status-ok)" : pc >= 0.4 ? "var(--accent)" : "var(--status-doubt)",
                                }}
                              />
                            </span>
                            <span className="w-8 text-right text-xs tabular-nums">{Math.round(pc * 100)}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Source: FPL match data (points, ICT, defensive stats) and Understat (shots, key passes, npxG, xGChain, xGBuildup). Percentile bars compare
        per-90 rates with {position ?? "same-position"} players who have {MIN_MINUTES}+ minutes this season.
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-white/[0.04] p-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none">{value}</p>
    </div>
  );
}
