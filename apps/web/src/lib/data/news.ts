import "server-only";
import { createClient } from "@/lib/supabase/server";

export type NewsEntry = {
  key: string;
  kind: "fpl" | "article";
  at: string; // ISO UTC
  title: string;
  summary: string | null;
  source: string;
  url: string | null;
  signal: string | null; // injury | suspension | transfer | ...
  players: { id: number; name: string }[];
  chanceNext: number | null;
};

const SOURCE_NAME: Record<string, string> = {
  bbc: "BBC Sport",
  guardian: "The Guardian",
  sky: "Sky Sports",
  ffscout: "Fantasy Football Scout",
  fpl: "FPL",
};
export const sourceName = (s: string) => SOURCE_NAME[s] ?? s;

const STATUS_SIGNAL: Record<string, string> = { i: "injury", d: "doubt", s: "suspension", u: "unavailable", n: "unavailable", a: "fit" };

/**
 * Feed berita Home: artikel RSS (sync_news) + perubahan status/berita pemain dari FPL (sync_bootstrap),
 * terbaru dulu. Pemain yang disebut dikenali worker dengan aturan nama.
 */
export async function getNewsFeed(limit = 30): Promise<NewsEntry[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 4 * 864e5).toISOString();
  const [newsRes, statusRes] = await Promise.all([
    supabase
      .from("news_items")
      .select("id, url, source, title, published_at, fetched_at, raw_text, news_entities(player_id, signal_type)")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase
      .from("player_status_snapshots")
      .select("id, player_id, captured_at, status, chance_next, news, news_added_utc")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(limit),
  ]);
  const news = newsRes.data ?? [];
  // Hanya berita FPL yang memang baru (news_added ≥ batas), satu (terbaru) per pemain.
  const latest = new Set<number>();
  const status = (statusRes.data ?? []).filter((s) => {
    if (!s.news || Date.parse(s.news_added_utc ?? s.captured_at) < Date.parse(since) || latest.has(s.player_id)) return false;
    latest.add(s.player_id);
    return true;
  });
  const ids = [...new Set([...news.flatMap((n) => n.news_entities.map((e) => e.player_id)), ...status.map((s) => s.player_id)].filter((x): x is number => x != null))];
  const namesRes = ids.length ? await supabase.from("players").select("id, web_name").in("id", ids) : { data: [] };
  const name = new Map((namesRes.data ?? []).map((p) => [p.id, p.web_name]));

  const articles: NewsEntry[] = news.map((n) => ({
    key: `n${n.id}`,
    kind: "article",
    at: n.published_at ?? n.fetched_at,
    title: n.title ?? "",
    summary: n.raw_text,
    source: sourceName(n.source),
    url: n.url,
    signal: n.news_entities.find((e) => e.signal_type !== "other")?.signal_type ?? null,
    players: [...new Set(n.news_entities.map((e) => e.player_id).filter((x): x is number => x != null))].map((id) => ({ id, name: name.get(id) ?? String(id) })),
    chanceNext: null,
  }));
  const fpl: NewsEntry[] = status.map((s) => ({
    key: `s${s.id}`,
    kind: "fpl",
    at: s.news_added_utc ?? s.captured_at,
    title: `${name.get(s.player_id) ?? "Player"}: ${s.news}`,
    summary: null,
    source: "FPL",
    url: null,
    signal: STATUS_SIGNAL[s.status ?? ""] ?? null,
    players: [{ id: s.player_id, name: name.get(s.player_id) ?? String(s.player_id) }],
    chanceNext: s.chance_next,
  }));
  return [...articles, ...fpl].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
