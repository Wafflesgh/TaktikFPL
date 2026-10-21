import "server-only";

// API FPL hanya dipanggil dari server (CORS memblokir browser) — read-only, tanpa login FPL.
const BASE = "https://fantasy.premierleague.com/api/";
const HEADERS = { "User-Agent": "TaktikFPL/0.1 (personal use)", Accept: "application/json" };

async function get<T>(path: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(BASE + path, { headers: HEADERS, next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type FplEntry = {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  current_event: number | null;
};

export type FplPick = { element: number; position: number; multiplier: number; is_captain: boolean; is_vice_captain: boolean };
export type FplPicks = {
  active_chip: string | null;
  entry_history: { event: number; bank: number; value: number; event_transfers: number; points: number };
  picks: FplPick[];
};

export const getEntry = (id: number) => get<FplEntry>(`entry/${id}/`);
export const getPicks = (id: number, gw: number) => get<FplPicks>(`entry/${id}/event/${gw}/picks/`);
