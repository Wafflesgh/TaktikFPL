import "server-only";
import { createClient } from "@/lib/supabase/server";

type WorkerResult<T> = { ok: boolean; status: number; data: T | null };

/** Panggil worker FastAPI dari server dengan meneruskan JWT pengguna (BLUEPRINT 13). */
export async function workerFetch<T>(path: string, init?: RequestInit): Promise<WorkerResult<T>> {
  const base = process.env.WORKER_API_URL;
  if (!base) return { ok: false, status: 0, data: null };
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.headers ?? {}),
        ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data: body };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
