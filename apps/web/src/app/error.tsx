"use client"; // Error boundary wajib Client Component

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = typeof error === "object" && error && "digest" in error ? String(error.digest) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
      <section className="glass flex flex-col gap-3 p-6">
        <h1 className="font-display text-3xl uppercase">Something went wrong</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Data could not be loaded. Usually the database connection is slow or the worker is
          updating data. Please try again in a moment.
        </p>
        {digest && <p className="text-xs text-[var(--text-muted)]">Code: {digest}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full bg-[var(--accent)] px-5 py-2 font-semibold text-white"
          >
            Try again
          </button>
          <Link href="/" className="rounded-full bg-white/10 px-5 py-2">
            Home
          </Link>
        </div>
      </section>
    </main>
  );
}
