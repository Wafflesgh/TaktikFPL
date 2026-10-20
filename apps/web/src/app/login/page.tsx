"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Pendaftaran ditutup setelah akun pertama dibuat (INFRA_BLUEPRINT 1 & Langkah 7).
        shouldCreateUser: true,
      },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="font-display text-5xl uppercase">TaktikFPL</h1>
        <p className="text-sm text-[var(--text-muted)]">Masuk dengan magic link yang dikirim ke email Anda.</p>
      </div>
      <form onSubmit={onSubmit} className="glass flex flex-col gap-3 p-5">
        <label htmlFor="email" className="text-sm">Email</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-xl border border-[var(--glass-border)] bg-black/30 px-3 py-2 outline-none focus:border-[var(--accent)]"
          placeholder="nama@email.com"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-full bg-[var(--accent)] px-4 py-2 font-semibold disabled:opacity-60"
        >
          {state === "sending" ? "Mengirim…" : "Kirim magic link"}
        </button>
        {state === "sent" && <p className="text-sm text-green-300">Cek email Anda dan klik tautan masuk.</p>}
        {state === "error" && <p className="text-sm text-red-300">Gagal: {message}</p>}
      </form>
    </main>
  );
}
