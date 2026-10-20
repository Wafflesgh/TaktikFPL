import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatWIB } from "@/lib/time";
import { workerFetch } from "@/lib/worker";

type WorkerHealth = {
  status: string;
  version: string;
  is_leader: boolean;
  db_ok: boolean;
  redis_ok: boolean | null;
  ai_tier: string;
  sources: Record<string, { last_fetch: string | null; requests_today: number | null }>;
  missing_optional_env: string[];
};

const STATUS_COLOR: Record<string, string> = {
  ok: "text-green-300",
  running: "text-sky-300",
  skipped: "text-amber-300",
  failed: "text-red-300",
};

export default async function AdminHealthPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: me } = await supabase.from("users").select("is_admin").eq("id", userId).maybeSingle();
  if (!me?.is_admin) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p>Halaman ini khusus admin.</p>
        <Link href="/" className="underline">Kembali</Link>
      </main>
    );
  }

  // RLS: job_runs hanya bisa dibaca admin.
  const [{ data: jobs }, worker] = await Promise.all([
    supabase.from("job_runs").select("id, job_name, status, started_at, finished_at, error").order("id", { ascending: false }).limit(40),
    workerFetch<WorkerHealth>("/v1/health"),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl uppercase">Admin · Health</h1>
        <Link href="/" className="glass px-4 py-2 text-sm">Beranda</Link>
      </header>

      <section className="glass p-4">
        <h2 className="mb-2 font-semibold">Worker</h2>
        {worker.data ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
            <dt className="text-[var(--text-muted)]">Status</dt><dd>{worker.data.status}</dd>
            <dt className="text-[var(--text-muted)]">Versi</dt><dd>{worker.data.version}</dd>
            <dt className="text-[var(--text-muted)]">Leader</dt><dd>{worker.data.is_leader ? "ya" : "tidak"}</dd>
            <dt className="text-[var(--text-muted)]">DB</dt><dd>{worker.data.db_ok ? "ok" : "gagal"}</dd>
            <dt className="text-[var(--text-muted)]">Redis</dt><dd>{worker.data.redis_ok == null ? "tidak dikonfigurasi" : worker.data.redis_ok ? "ok" : "gagal"}</dd>
            <dt className="text-[var(--text-muted)]">AI tier</dt><dd>{worker.data.ai_tier}</dd>
            {Object.entries(worker.data.sources).map(([src, s]) => (
              <div key={src} className="contents">
                <dt className="text-[var(--text-muted)]">Sumber {src}</dt>
                <dd>{formatWIB(s.last_fetch)} · {s.requests_today ?? 0} req hari ini</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-red-300">Worker tidak terjangkau (WORKER_API_URL, status {worker.status}).</p>
        )}
        {worker.data && worker.data.missing_optional_env.length > 0 && (
          <p className="mt-3 text-xs text-[var(--text-muted)]">Env opsional belum diisi: {worker.data.missing_optional_env.join(", ")}</p>
        )}
      </section>

      <section className="glass overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">Job terakhir</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--text-muted)]">
            <tr><th className="py-1">Job</th><th>Status</th><th>Mulai</th><th>Selesai</th></tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((j) => (
              <tr key={j.id} className="border-t border-white/5" title={j.error ?? undefined}>
                <td className="py-1">{j.job_name}</td>
                <td className={STATUS_COLOR[j.status] ?? ""}>{j.status}</td>
                <td>{formatWIB(j.started_at)}</td>
                <td>{formatWIB(j.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
