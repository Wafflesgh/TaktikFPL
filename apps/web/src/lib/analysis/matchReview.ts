import type { Style, TeamRow } from "@/lib/data/league";
import { fmt1, fmt2, best, ordinal, type Insight } from "@/lib/analysis/types";

export type ShotRow = { team_id: number | null; minute: number | null; xg: number | null; result: string | null; situation: string | null };

export type ReviewInput = {
  row: TeamRow;
  teamName: string;
  oppName: string;
  style: Style | null; // norma tim (19 laga terakhir)
  oppStyle: Style | null;
  oppTablePos: number | null;
  tableSize: number;
  shots: ShotRow[]; // semua tembakan laga itu (kedua tim)
  missingRegulars: string[];
  redCards: { own: string[]; opp: string[] };
};

export type Review = { verdict: string; tone: Insight["tone"]; headline: string; insights: Insight[] };

const BIG_CHANCE = 0.3; // xG tembakan ≥ 0.3 = peluang emas
const SET_PIECE = new Set(["FromCorner", "SetPiece", "DirectFreekick"]);

/**
 * Review satu laga dari sudut pandang tim: vonis (dari selisih xG vs hasil) + alasan fundamental
 * (lawan, absen, kartu merah, kandang/tandang) dan teknis (blok, pressing, wilayah, bola mati,
 * penyelesaian, jalannya laga). Semua ambang relatif terhadap norma tim itu sendiri bila ada.
 */
export function reviewMatch(i: ReviewInput): Review {
  const { row, oppName, style, oppStyle } = i;
  const s = row.stat;
  const o = row.oppStat;
  const res = row.result;
  const gf = row.gf ?? 0;
  const ga = row.ga ?? 0;
  const out: Insight[] = [];
  const lostOrDrew = res === "L" || res === "D";

  const mine = i.shots.filter((x) => x.team_id != null && (row.home ? x.team_id === row.fx.homeId : x.team_id === row.fx.awayId));
  const theirs = i.shots.filter((x) => x.team_id != null && !mine.includes(x));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const big = (xs: ShotRow[]) => xs.filter((x) => (x.xg ?? 0) >= BIG_CHANCE);
  const goals = (xs: ShotRow[]) => xs.filter((x) => x.result === "Goal");

  const xgF = s?.xg ?? null;
  const xgA = s?.xga ?? null;
  let verdict = res === "W" ? "Win" : res === "L" ? "Defeat" : "Draw";
  let tone: Insight["tone"] = res === "W" ? "good" : res === "L" ? "bad" : "neutral";
  let headline = `${gf}–${ga} ${row.home ? "vs" : "at"} ${oppName}`;

  if (xgF != null && xgA != null) {
    const d = xgF - xgA;
    if (res === "L") verdict = d >= 0.4 ? "Unlucky defeat" : d <= -0.8 ? "Deserved defeat" : "Narrow defeat";
    else if (res === "W") verdict = d >= 0.8 ? "Deserved win" : d <= -0.4 ? "Fortunate win" : "Tight win";
    else if (res === "D") verdict = d >= 0.5 ? "Should have won" : d <= -0.5 ? "Got away with a point" : "Fair draw";
    if (verdict === "Unlucky defeat" || verdict === "Should have won") tone = "neutral";
    headline = `Created ${fmt2(xgF)} xG, allowed ${fmt2(xgA)} xG`;
    const bF = big(mine).length;
    const bA = big(theirs).length;
    out.push({
      kind: "Technical",
      tone: d >= 0.4 ? "good" : d <= -0.4 ? "bad" : "neutral",
      text:
        d <= -0.4
          ? `Out-created: ${fmt2(xgF)} xG vs ${fmt2(xgA)} — ${plural(mine.length, "shot")} (${plural(bF, "big chance")}) against ${theirs.length} (${bA}).`
          : d >= 0.4
            ? `Controlled the chances: ${fmt2(xgF)} xG vs ${fmt2(xgA)} — ${plural(mine.length, "shot")} (${plural(bF, "big chance")}) against ${theirs.length} (${bA}).`
            : `Even game on chances: ${fmt2(xgF)} xG vs ${fmt2(xgA)}; big chances ${bF} vs ${bA}.`,
    });
    if (gf - xgF <= -0.9) {
      out.push({ kind: "Technical", tone: "bad", text: `Wasteful finishing: ${gf} goal${gf === 1 ? "" : "s"} from ${fmt2(xgF)} xG.` });
    } else if (gf - xgF >= 0.9 && res !== "L") {
      out.push({ kind: "Technical", tone: "good", text: `Clinical: ${gf} goals from only ${fmt2(xgF)} xG.` });
    }
    if (ga - xgA >= 0.9) {
      out.push({ kind: "Technical", tone: "bad", text: `${oppName} were clinical: ${ga} goals from ${fmt2(xgA)} xG.` });
    } else if (xgA - ga >= 0.9) {
      out.push({ kind: "Technical", tone: "good", text: `Kept ${oppName} below their chances: ${ga} conceded from ${fmt2(xgA)} xG (keeper/last-ditch defending).` });
    }
  }

  // Blok & pressing vs norma tim sendiri.
  if (s?.ppda != null && style && style.ppda > 0) {
    const r = s.ppda / style.ppda;
    if (r >= 1.35)
      out.push({
        kind: "Technical",
        tone: lostOrDrew ? "bad" : "neutral",
        text: `Sat much deeper than usual: PPDA ${fmt1(s.ppda)} vs a ${fmt1(style.ppda)} norm — ${oppName} were allowed to dictate possession.`,
      });
    else if (r <= 0.75)
      out.push({ kind: "Technical", tone: res === "L" ? "neutral" : "good", text: `Pressed higher than usual: PPDA ${fmt1(s.ppda)} vs a ${fmt1(style.ppda)} norm.` });
  }
  // Wilayah: umpan masuk ±20 m dari gawang.
  if (s?.deep != null && s.deepAllowed != null) {
    const gap = s.deepAllowed - s.deep;
    if (gap >= 5)
      out.push({ kind: "Technical", tone: "bad", text: `Pinned back: ${oppName} made ${s.deepAllowed} deep completions (passes into the final 20 m) vs ${s.deep}.` });
    else if (gap <= -5)
      out.push({ kind: "Technical", tone: "good", text: `Territorial control: ${s.deep} deep completions vs ${s.deepAllowed} for ${oppName}.` });
  }
  // Blok rendah lawan.
  if (o?.ppda != null && xgF != null && mine.length >= 12 && xgF < 1.1 && (o.ppda >= 15 || oppStyle?.bucket === "low_block")) {
    out.push({
      kind: "Technical",
      tone: "bad",
      text: `Couldn't break the low block: ${mine.length} shots but only ${fmt2(xgF)} xG (${fmt2(xgF / mine.length)} per shot) against ${oppName}'s deep defence (PPDA ${fmt1(o.ppda)}).`,
    });
  }
  // Bola mati.
  const spAgainst = theirs.filter((x) => SET_PIECE.has(x.situation ?? ""));
  const spXg = spAgainst.reduce((a, x) => a + (x.xg ?? 0), 0);
  const spGoals = goals(spAgainst).length;
  if (spGoals > 0 || spXg >= 0.5)
    out.push({
      kind: "Technical",
      tone: "bad",
      text: `Set-piece weakness: conceded ${spGoals} goal${spGoals === 1 ? "" : "s"} and ${fmt2(spXg)} xG from corners/free kicks.`,
    });
  const spFor = mine.filter((x) => SET_PIECE.has(x.situation ?? ""));
  if (goals(spFor).length > 0 && res !== "L")
    out.push({ kind: "Technical", tone: "good", text: `Set pieces paid off: ${goals(spFor).length} goal${goals(spFor).length === 1 ? "" : "s"} from corners/free kicks.` });

  // Jalannya laga (menit gol dari data tembakan; gol bunuh diri tidak tercatat).
  const gMine = goals(mine).map((x) => x.minute ?? 0).sort((a, b) => a - b);
  const gTheirs = goals(theirs).map((x) => x.minute ?? 0).sort((a, b) => a - b);
  const firstMine = gMine[0] ?? Infinity;
  const firstTheirs = gTheirs[0] ?? Infinity;
  if (firstTheirs < firstMine && res !== "W" && Number.isFinite(firstTheirs))
    out.push({ kind: "Technical", tone: "bad", text: `Conceded first (${firstTheirs}') and had to chase the game.` });
  if (firstMine < firstTheirs && res !== "W" && Number.isFinite(firstMine))
    out.push({ kind: "Technical", tone: "bad", text: `Led from ${firstMine}' but couldn't hold on.` });
  const late = gTheirs.filter((m) => m >= 80).length;
  if (late > 0 && res !== "W") out.push({ kind: "Technical", tone: "bad", text: `Late damage: conceded ${late} goal${late === 1 ? "" : "s"} after 80'.` });

  // Fundamental.
  if (i.redCards.own.length) out.push({ kind: "Fundamental", tone: "bad", text: `Red card: ${i.redCards.own.join(", ")} — played part of the game with ten.` });
  if (i.redCards.opp.length) out.push({ kind: "Fundamental", tone: "good", text: `${oppName} had a player sent off (${i.redCards.opp.join(", ")}).` });
  if (i.missingRegulars.length)
    out.push({
      kind: "Fundamental",
      tone: "bad",
      text: `Without regular starter${i.missingRegulars.length === 1 ? "" : "s"}: ${i.missingRegulars.join(", ")}.`,
    });
  if (i.oppTablePos != null) {
    const top = i.oppTablePos <= 6;
    const bottom = i.oppTablePos > i.tableSize - 6;
    const extra = oppStyle ? ` (${best(oppStyle.rankAttack)} attack, ${best(oppStyle.rankDefence)} defence by xG)` : "";
    if (top) out.push({ kind: "Fundamental", tone: res === "L" ? "neutral" : "good", text: `Strong opponent: ${oppName} are ${ordinal(i.oppTablePos)}${extra}.` });
    else if (bottom && lostOrDrew) out.push({ kind: "Fundamental", tone: "bad", text: `Dropped points against a bottom-six side: ${oppName} are ${ordinal(i.oppTablePos)}${extra}.` });
  }
  out.push({ kind: "Fundamental", tone: "neutral", text: row.home ? "Played at home." : `Away at ${oppName}.` });

  // Untuk kekalahan/seri: alasan negatif dulu.
  const order = { bad: 0, neutral: 1, good: 2 } as const;
  if (lostOrDrew) out.sort((a, b) => order[a.tone] - order[b.tone]);
  else out.sort((a, b) => order[b.tone] - order[a.tone]);
  return { verdict, tone, headline, insights: out };
}
