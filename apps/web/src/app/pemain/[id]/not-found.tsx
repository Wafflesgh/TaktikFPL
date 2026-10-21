import Link from "next/link";

export default function PlayerNotFound() {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4 text-center">
      <div className="glass p-8">
        <h1 className="font-display text-4xl uppercase">Player not found</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Invalid player ID or not in the database yet.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white">
          Kembali ke Beranda
        </Link>
      </div>
    </main>
  );
}
