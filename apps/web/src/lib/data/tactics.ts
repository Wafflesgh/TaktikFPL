import "server-only";
import { createClient } from "@/lib/supabase/server";

export type StyleSplit = { minutes: number; xgi90: number; shrunk: number; ratio: number };

export type PlayerTacticsJson = {
  roles: Record<string, number>;
  primary_role: string | null;
  starts: number;
  minutes: number;
  xgi90: number;
  split: Record<string, StyleSplit>;
  set_piece_xg_share: number;
  xg_chain90: number;
};

/** Profil taktik terbaru (snapshot worker sync_understat, window 'tactical'). */
export async function getPlayerTactics(playerId: number): Promise<{ asOf: string; t: PlayerTacticsJson } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("player_form_features")
    .select("as_of, metrics")
    .eq("player_id", playerId)
    .eq("window_label", "tactical")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { asOf: data.as_of, t: data.metrics as PlayerTacticsJson };
}
