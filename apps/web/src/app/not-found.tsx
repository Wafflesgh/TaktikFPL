import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
      <section className="glass flex flex-col gap-3 p-6">
        <p className="font-display text-6xl text-[var(--accent)]">404</p>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-[var(--text-muted)]">The page may not exist yet or the link is wrong.</p>
        <Link href="/" className="w-fit rounded-full bg-[var(--accent)] px-5 py-2 font-semibold text-white">
          Back to Home
        </Link>
      </section>
    </main>
  );
}
