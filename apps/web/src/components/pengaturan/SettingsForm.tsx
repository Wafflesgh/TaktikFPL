"use client";

import { useActionState } from "react";
import { saveSettings, type SettingsState, type SettingsValues } from "@/app/pengaturan/actions";
import { Panel } from "@/components/ui";
import { DISPLAY_NAME_MAX, RISK_OPTIONS, THEME_OPTIONS } from "@/lib/preferences";

const optionCard =
  "flex cursor-pointer gap-3 rounded-2xl border border-[var(--glass-border)] bg-white/[0.04] p-3 hover:bg-white/[0.07] has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)]";

/** Form /pengaturan. Nilai default diambil dari state action agar form tidak kembali ke nilai lama setelah reset. */
export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveSettings, {
    status: "idle",
    message: "",
    values: initial,
  });
  const v = state.values;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Panel title="Profile" subtitle="Name shown in the top bar">
        <label htmlFor="displayName" className="text-sm">
          Nama tampilan
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          defaultValue={v.displayName}
          className="mt-2 w-full max-w-md rounded-xl border border-[var(--glass-border)] bg-black/30 px-3 py-2 outline-none focus:border-[var(--accent)]"
        />
      </Panel>

      <Panel title="Theme" subtitle="App colours on every page">
        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="sr-only">Theme</legend>
          {THEME_OPTIONS.map((o) => (
            <label key={o.value} className={`${optionCard} flex-col`}>
              {/* Pratinjau memakai token tema itu sendiri (tokens.css) lewat data-theme lokal. */}
              <span
                data-theme={o.value}
                aria-hidden="true"
                className="relative block h-20 overflow-hidden rounded-xl border border-[var(--glass-border)]"
                style={{ background: "var(--bg)", backgroundImage: "var(--bg-glow)" }}
              >
                <span className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-lg bg-[var(--bg-elev)] p-2">
                  <span className="h-4 w-4 rounded-full bg-[var(--accent)]" />
                  <span className="h-1.5 flex-1 rounded-full bg-[var(--text-muted)] opacity-60" />
                  <span className="h-3 w-8 rounded-full bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]" />
                </span>
              </span>
              <span className="flex items-start gap-2">
                <input type="radio" name="theme" value={o.value} defaultChecked={v.theme === o.value} className="mt-1 accent-[var(--accent)]" />
                <span>
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{o.hint}</span>
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </Panel>

      <Panel title="Risk profile" subtitle="Used when building transfer & captain recommendations">
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Risk profile</legend>
          {RISK_OPTIONS.map((o) => (
            <label key={o.value} className={`${optionCard} items-start`}>
              <input type="radio" name="riskProfile" value={o.value} defaultChecked={v.riskProfile === o.value} className="mt-1 accent-[var(--accent)]" />
              <span>
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-[var(--text-muted)]">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Panel>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[var(--accent)] px-6 py-2 font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${state.status === "success" ? "text-green-300" : state.status === "error" ? "text-red-300" : ""}`}
        >
          {pending ? "" : state.message}
        </p>
      </div>
    </form>
  );
}
