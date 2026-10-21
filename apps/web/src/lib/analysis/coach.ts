import type { Style } from "@/lib/data/league";
import { fmt1, fmt2, best, ordinal, pct, type Insight } from "@/lib/analysis/types";

export type TacticsInput = {
  teamName: string;
  style: Style | null;
  formationUsage: { formation: string; matches: number }[];
  sample: number;
  setPieceShareFor: number | null;
  setPieceShareAgainst: number | null;
  crossShareFor: number | null;
  xgPerShot: number | null;
  xgPerShotAgainst: number | null;
};

/**
 * Cara bermain tim dari data (bukan opini): bentuk dasar dari lineup, pressing & blok dari PPDA,
 * dominasi wilayah dari deep completions, kualitas peluang dari xG/tembakan, ketergantungan bola mati
 * dan umpan silang dari situasi tembakan. Peringkat relatif terhadap tim liga musim ini.
 */
export function tacticsInsights(i: TacticsInput): Insight[] {
  const out: Insight[] = [];
  const s = i.style;
  const top = i.formationUsage[0];
  if (top) {
    const alt = i.formationUsage.slice(1, 3).map((f) => `${f.formation} (${f.matches})`);
    out.push({
      kind: "Technical",
      tone: "neutral",
      text: `Base shape ${top.formation} in ${top.matches} of the last ${i.sample} matches${alt.length ? `; also ${alt.join(", ")}` : ""}.`,
    });
  }
  if (s) {
    const press =
      s.bucket === "high_press"
        ? `Aggressive press: PPDA ${fmt1(s.ppda)} (${ordinal(s.rankPress)} most intense of ${s.n}) — they win the ball high and force mistakes.`
        : s.bucket === "low_block"
          ? `Low block: PPDA ${fmt1(s.ppda)} (${ordinal(s.n + 1 - s.rankPress)} most passive of ${s.n}) — they concede possession and defend deep.`
          : `Mid block: PPDA ${fmt1(s.ppda)} (${ordinal(s.rankPress)} of ${s.n} for pressing intensity) — selective pressing.`;
    out.push({ kind: "Technical", tone: "neutral", text: press });
    out.push({
      kind: "Technical",
      tone: s.rankTerritory <= 6 ? "good" : s.rankTerritory > s.n - 6 ? "bad" : "neutral",
      text: `Territory: ${fmt1(s.deep)} deep completions per match (${ordinal(s.rankTerritory)}) vs ${fmt1(s.deepAllowed)} allowed (${ordinal(s.rankDeepAllowed)} fewest).`,
    });
    out.push({
      kind: "Fundamental",
      tone: s.rankAttack <= 6 ? "good" : s.rankAttack > s.n - 6 ? "bad" : "neutral",
      text: `Attack: ${fmt2(s.xg)} xG per match (${ordinal(s.rankAttack)} of ${s.n}).`,
    });
    out.push({
      kind: "Fundamental",
      tone: s.rankDefence <= 6 ? "good" : s.rankDefence > s.n - 6 ? "bad" : "neutral",
      text: `Defence: ${fmt2(s.xga)} xG conceded per match (${best(s.rankDefence)} of ${s.n}).`,
    });
  }
  if (i.xgPerShot != null && i.xgPerShotAgainst != null)
    out.push({
      kind: "Technical",
      tone: i.xgPerShot >= i.xgPerShotAgainst ? "good" : "bad",
      text: `Chance quality: ${fmt2(i.xgPerShot)} xG per shot taken vs ${fmt2(i.xgPerShotAgainst)} per shot allowed${i.xgPerShot < 0.09 ? " — many low-value efforts from distance" : ""}.`,
    });
  if (i.setPieceShareFor != null && i.setPieceShareFor >= 0.25)
    out.push({ kind: "Technical", tone: "neutral", text: `Set-piece reliant: ${pct(i.setPieceShareFor)} of their xG comes from corners and free kicks.` });
  if (i.setPieceShareAgainst != null && i.setPieceShareAgainst >= 0.3)
    out.push({ kind: "Technical", tone: "bad", text: `Vulnerable at set pieces: ${pct(i.setPieceShareAgainst)} of the xG they concede comes from corners and free kicks.` });
  if (i.crossShareFor != null && i.crossShareFor >= 0.22)
    out.push({ kind: "Technical", tone: "neutral", text: `Wide, crossing game: ${pct(i.crossShareFor)} of their shots come straight from crosses.` });
  return out;
}
