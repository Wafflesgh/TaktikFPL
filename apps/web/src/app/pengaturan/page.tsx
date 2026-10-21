import type { Metadata } from "next";
import { SettingsForm } from "@/components/pengaturan/SettingsForm";
import { BottomNav } from "@/components/shell/NavLinks";
import { TopBar } from "@/components/shell/TopBar";
import { getViewer } from "@/lib/data/viewer";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings · TaktikFPL" };

async function getLiveCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("fixtures").select("id", { count: "exact", head: true }).in("status", ["live", "ht"]);
  return count ?? 0;
}

/** Pengaturan: nama tampilan, tema, profil risiko (cookie browser). */
export default async function PengaturanPage() {
  const [viewer, liveCount] = await Promise.all([getViewer(), getLiveCount()]);

  return (
    <div className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
      <TopBar displayName={viewer.displayName} isAdmin={viewer.isAdmin} liveCount={liveCount} />

      <main className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
        <div>
          <h1 className="font-display text-4xl uppercase lg:text-5xl">Settings</h1>
          <p className="text-sm text-[var(--text-muted)]">Display and play-style preferences. Saved in this browser.</p>
        </div>
        <SettingsForm
          initial={{
            displayName: viewer.savedDisplayName ?? viewer.displayName,
            theme: viewer.theme,
            riskProfile: viewer.riskProfile,
          }}
        />
      </main>

      <BottomNav />
    </div>
  );
}
