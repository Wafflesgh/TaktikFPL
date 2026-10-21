import type { Style, TeamRow } from "@/lib/data/league";
import { formText } from "@/lib/form";
import { POSITION_NAME } from "@/lib/positions";
import { clamp, fmt1, fmt2, best, ordinal, pct, type Insight } from "@/lib/analysis/types";

export type Duelist = {
  id: number;
  name: string;
  slot: string;
  startsInSlot: number;
  sample: number;
  formLabel: string | null;
  formScore: number | null; // persentil form 4 laga dalam posisi FPL (0..1)
  last4Ppm: number | null;
  xgi90: number | null;
  defcon90: number | null;
};

export type StyleSplit = { minutes: number; xgi90: number; ratio: number };

export type OutlookInput = {
  playerName: string;
  position: string | null; // GKP | DEF | MID | FWD
  role: string | null; // slot utama Understat
  form: { label: string | null; score: number | null; last4Ppm: number | null } | null;
  xgi90: number | null;
  split: Record<string, StyleSplit> | null;
  row: TeamRow;
  oppName: string;
  oppStyle: Style | null;
  oppLast5: ("W" | "D" | "L")[];
  duel: Duelist[];
  xpts: number | null;
};

export type Outlook = { level: 1 | 2 | 3 | 4 | 5; label: string; score: number; summary: string; insights: Insight[] };

const LABELS = ["", "Very favourable", "Favourable", "Neutral", "Tough", "Very tough"] as const;

type Factor = { w: number; s: number; insight: Insight; short: string };

const tone = (s: number): Insight["tone"] => (s >= 0.2 ? "good" : s <= -0.2 ? "bad" : "neutral");
/** Peringkat 1..n → skor -1 (terbaik lawan = paling sulit) … +1. */
const rankScore = (rank: number, n: number) => (n > 1 ? (2 * (rank - 1)) / (n - 1) - 1 : 0);

/**
 * Tingkat kesulitan satu laga untuk satu pemain (1 = sangat menguntungkan … 5 = sangat sulit).
 * Skor = rata-rata tertimbang faktor −1..+1 (positif = lebih mudah):
 *  Fundamental — kekuatan lawan (pertahanan untuk MID/FWD, serangan untuk GKP/DEF), form lawan, kandang/tandang.
 *  Teknis — gaya lawan vs catatan pemain melawan gaya itu, dan duel zona (lawan yang berhadapan langsung
 *  dengan posisi utamanya, form keduanya).
 */
export function fixtureOutlook(i: OutlookInput): Outlook {
  const f: Factor[] = [];
  const st = i.oppStyle;
  const attacker = i.position === "MID" || i.position === "FWD";
  const opp = i.oppName;

  if (st && st.n > 1) {
    if (attacker) {
      const s = rankScore(st.rankDefence, st.n);
      f.push({
        w: 0.3,
        s,
        short: s < 0 ? `${opp}'s defence is ${best(st.rankDefence)}` : `${opp}'s defence is ${ordinal(st.rankDefence)} of ${st.n}`,
        insight: { kind: "Fundamental", tone: tone(s), text: `${opp} concede ${fmt2(st.xga)} xG per match — ${best(st.rankDefence)} defence of ${st.n}.` },
      });
    } else {
      const s = rankScore(st.rankAttack, st.n);
      f.push({
        w: 0.3,
        s,
        short: s < 0 ? `${opp} have the ${best(st.rankAttack)} attack` : `${opp}'s attack ranks ${ordinal(st.rankAttack)}`,
        insight: { kind: "Fundamental", tone: tone(s), text: `${opp} create ${fmt2(st.xg)} xG per match — ${best(st.rankAttack)} attack of ${st.n}.` },
      });
    }
  }

  if (i.oppLast5.length >= 3) {
    const ppg = i.oppLast5.reduce((a, r) => a + (r === "W" ? 3 : r === "D" ? 1 : 0), 0) / i.oppLast5.length;
    const s = clamp(-(ppg - 1.4) / 1.4);
    f.push({
      w: 0.15,
      s,
      short: s < 0 ? `${opp} are in form` : `${opp} are out of form`,
      insight: { kind: "Fundamental", tone: tone(s), text: `${opp} form: ${i.oppLast5.join(" ")} (oldest → latest, ${ppg.toFixed(1)} pts per match).` },
    });
  }

  f.push({
    w: 0.1,
    s: i.row.home ? 0.5 : -0.5,
    short: i.row.home ? "home advantage" : "away trip",
    insight: { kind: "Fundamental", tone: "neutral", text: i.row.home ? `At home to ${opp}.` : `Away at ${opp}.` },
  });

  // Gaya lawan vs catatan pemain.
  if (st) {
    if (attacker || i.position === "DEF") {
      const split = i.split?.[st.bucket];
      const styleText =
        st.bucket === "low_block"
          ? `${opp} defend deep (PPDA ${fmt1(st.ppda)}, ${ordinal(st.n + 1 - st.rankPress)} most passive)`
          : st.bucket === "high_press"
            ? `${opp} press high (PPDA ${fmt1(st.ppda)}, ${ordinal(st.rankPress)} most aggressive)`
            : `${opp} use a mid block (PPDA ${fmt1(st.ppda)})`;
      if (split && i.xgi90 != null && split.minutes >= 180) {
        const s = clamp((split.ratio - 1) / 0.15);
        const label = st.bucket.replace("_", " ").replace("block", "blocks").replace("press", "pressing teams");
        f.push({
          w: 0.2,
          s,
          short:
            s <= -0.2 ? `${i.playerName} struggles vs ${label}` : s >= 0.2 ? `${i.playerName} does well vs ${label}` : `${i.playerName} is about average vs ${label}`,
          insight: {
            kind: "Technical",
            tone: tone(s),
            text: `${styleText}. ${i.playerName}'s xGI/90 vs ${label}: ${fmt2(split.xgi90)} (${Math.round(split.minutes)} mins) vs ${fmt2(i.xgi90)} overall.`,
          },
        });
      } else if (attacker && st.bucket === "low_block") {
        f.push({
          w: 0.2,
          s: -0.3,
          short: "low block limits space",
          insight: { kind: "Technical", tone: "bad", text: `${styleText} — little space in behind; chances depend on creativity and composure in tight areas.` },
        });
      } else if (attacker && st.bucket === "high_press") {
        f.push({
          w: 0.2,
          s: 0.2,
          short: "space behind a high line",
          insight: { kind: "Technical", tone: "good", text: `${styleText} — a high line leaves space in behind for runners.` },
        });
      }
    }
    if (!attacker) {
      // Bek/kiper: tekanan wilayah dari lawan.
      const s = rankScore(st.rankTerritory, st.n);
      f.push({
        w: 0.15,
        s,
        short: s < 0 ? `${opp} sustain pressure` : `${opp} rarely pin teams back`,
        insight: { kind: "Technical", tone: tone(s), text: `${opp} average ${fmt1(st.deep)} deep completions per match (${ordinal(st.rankTerritory)} most) — ${s < 0 ? "expect sustained pressure" : "limited sustained pressure"}.` },
      });
    }
  }

  // Duel zona: lawan yang berhadapan langsung dengan posisi utama pemain.
  const d = i.duel[0];
  if (d && i.role) {
    const mine = i.form?.score ?? 0.5;
    const theirs = d.formScore ?? 0.5;
    const s = clamp((mine - theirs) * 1.6);
    const roleName = POSITION_NAME[i.role] ?? i.role;
    const dStat = attacker
      ? d.defcon90 != null
        ? `, ${fmt1(d.defcon90)} def. contributions/90`
        : ""
      : d.xgi90 != null
        ? `, ${fmt2(d.xgi90)} xGI/90`
        : "";
    const dForm = d.formScore != null ? `${formText(d.formLabel) ?? "form"} (form ${pct(d.formScore)}, ${d.last4Ppm != null ? fmt1(d.last4Ppm) : "-"} pts/match last 4${dStat})` : "no recent form data";
    const meForm = i.form?.score != null ? `${i.playerName} is ${formText(i.form.label) ?? "—"} (form ${pct(i.form.score)})` : `${i.playerName} has no recent form data`;
    f.push({
      w: 0.25,
      s,
      short:
        s <= -0.2 ? `${d.name} (${d.slot}) has the edge` : s >= 0.2 ? `${i.playerName} has the edge over ${d.name}` : `even duel with ${d.name}`,
      insight: {
        kind: "Technical",
        tone: tone(s),
        text: `Zone duel: from ${roleName} (${i.role}), ${i.playerName} faces ${d.name} (${d.slot}, ${d.startsInSlot}/${d.sample} recent starts there): ${dForm}. ${meForm}.`,
      },
    });
    for (const x of i.duel.slice(1, 2)) {
      if (x.formScore == null) continue;
      f.push({
        w: 0.1,
        s: clamp((0.5 - x.formScore) * 1.6),
        short: `${x.name} support`,
        insight: {
          kind: "Technical",
          tone: tone(clamp((0.5 - x.formScore) * 1.6)),
          text: `Cover from ${x.name} (${x.slot}): ${formText(x.formLabel) ?? "form"} (form ${pct(x.formScore)}).`,
        },
      });
    }
  }

  const wSum = f.reduce((a, x) => a + x.w, 0);
  const score = wSum > 0 ? f.reduce((a, x) => a + x.w * x.s, 0) / wSum : 0;
  const level = (score >= 0.35 ? 1 : score >= 0.12 ? 2 : score > -0.12 ? 3 : score > -0.35 ? 4 : 5) as Outlook["level"];
  const drivers = [...f].sort((a, b) => (level >= 3 ? a.s * a.w - b.s * b.w : b.s * b.w - a.s * a.w)).slice(0, 2);
  const summary = `${LABELS[level]}: ${drivers.map((x) => x.short).join("; ")}.`;
  const order = level >= 4 ? (a: Factor, b: Factor) => a.s - b.s : (a: Factor, b: Factor) => b.s - a.s;
  return { level, label: LABELS[level], score, summary, insights: [...f].sort(order).map((x) => x.insight) };
}
