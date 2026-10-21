// Slot posisi Understat per laga → nama & koordinat di lapangan (x, y dalam %, serangan ke atas).
// Understat mencatat slot posisi, bukan peran gaya FM (mis. "Inverted Forward").
export const POSITION_NAME: Record<string, string> = {
  GK: "Goalkeeper",
  DR: "Right-back",
  DL: "Left-back",
  DC: "Centre-back",
  DMR: "Right wing-back",
  DML: "Left wing-back",
  DMC: "Defensive mid",
  MR: "Right mid",
  ML: "Left mid",
  MC: "Central mid",
  AMR: "Right winger",
  AML: "Left winger",
  AMC: "Attacking mid",
  FWR: "Right forward",
  FWL: "Left forward",
  FW: "Striker",
  Sub: "Off the bench",
};

export const PITCH_SLOTS: { pos: string; x: number; y: number }[] = [
  { pos: "FWL", x: 26, y: 11 },
  { pos: "FW", x: 50, y: 9 },
  { pos: "FWR", x: 74, y: 11 },
  { pos: "AML", x: 13, y: 27 },
  { pos: "AMC", x: 50, y: 28 },
  { pos: "AMR", x: 87, y: 27 },
  { pos: "ML", x: 13, y: 45 },
  { pos: "MC", x: 50, y: 46 },
  { pos: "MR", x: 87, y: 45 },
  { pos: "DML", x: 13, y: 62 },
  { pos: "DMC", x: 50, y: 63 },
  { pos: "DMR", x: 87, y: 62 },
  { pos: "DL", x: 13, y: 78 },
  { pos: "DC", x: 50, y: 79 },
  { pos: "DR", x: 87, y: 78 },
  { pos: "GK", x: 50, y: 93 },
];

// Baris formasi dari slot Understat (bek → penyerang). DML/DMR = wing-back (baris gelandang bertahan).
const ROWS: string[][] = [
  ["DL", "DC", "DR"],
  ["DML", "DMC", "DMR"],
  ["ML", "MC", "MR"],
  ["AML", "AMC", "AMR"],
  ["FWL", "FW", "FWR"],
];

/** Slot 10 pemain outfield starter → formasi, mis. ["DL","DC","DC","DR","DMC","DMC","AML","AMC","AMR","FW"] → "4-2-3-1". */
export function formationOf(slots: string[]): string | null {
  const counts = ROWS.map((row) => slots.filter((s) => row.includes(s)).length).filter((n) => n > 0);
  const total = counts.reduce((a, n) => a + n, 0);
  return total === 10 ? counts.join("-") : null;
}

export type Side = "L" | "C" | "R";
export function sideOf(slot: string): Side {
  if (/^(DL|DML|ML|AML|FWL)$/.test(slot)) return "L";
  if (/^(DR|DMR|MR|AMR|FWR)$/.test(slot)) return "R";
  return "C";
}
const rowOf = (slot: string) => ROWS.findIndex((r) => r.includes(slot));

/**
 * Slot lawan yang berhadapan langsung dengan slot ini (sisi berlawanan, sisi lapangan dicerminkan):
 * penyerang/gelandang sayap kanan (AMR, MR, FWR) ↔ bek & wing-back kiri lawan (DL, DML) + bek tengah;
 * penyerang tengah ↔ bek tengah & gelandang bertahan; bek ↔ penyerang/sayap lawan di sisi itu.
 */
export function facingSlots(slot: string): string[] {
  const side = sideOf(slot);
  const mirror: Side = side === "L" ? "R" : side === "R" ? "L" : "C";
  const row = rowOf(slot);
  if (slot === "GK") return ["FW", "FWL", "FWR", "AMC"];
  const attacking = row >= 2; // M, AM, FW → hadapi bek lawan
  if (attacking) {
    if (mirror === "C") return ["DC", "DMC"];
    return mirror === "L" ? ["DL", "DML", "DC"] : ["DR", "DMR", "DC"];
  }
  // Bek / gelandang bertahan → hadapi penyerang lawan di sisinya
  if (mirror === "C") return ["FW", "AMC", "FWL", "FWR"];
  return mirror === "L" ? ["AML", "ML", "FWL"] : ["AMR", "MR", "FWR"];
}
