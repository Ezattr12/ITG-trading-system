import { requireAdmin } from "@/lib/admin/require-admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { listSystemSettings } from "@/lib/admin/queries";
import { SettingForm } from "@/components/admin/admin-forms";

export const metadata = { title: "Admin — Settings — ITG TraderOS" };

/**
 * Admin system settings + AI config (Phase 10, spec §10, §28).
 *
 * AI Coach status is shown honestly: the coach is deterministic
 * (rule-based, real stored data only — Phase 9) and NO external
 * LLM is connected. There is no toggle that can pretend otherwise:
 * `llm_connected` is not an editable setting, and `ai_coach_mode`
 * only accepts "deterministic" (validated in lib/admin/validation).
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * flat header band, the AI Coach configuration panel as an
 * elevated v2 card (a display panel, shown WITHOUT any violet
 * — admin is not an AI surface), and the setting rows as flat
 * v2 cards (they contain forms). The settings read, the form
 * wiring and all copy are exactly as before.
 */

const SETTING_META: Record<string, { label: string; hint: string }> = {
  registration_open: {
    label: "Registration open",
    hint: 'JSON boolean — "true" or "false".',
  },
  maintenance_mode: {
    label: "Maintenance mode",
    hint: 'JSON boolean — "true" or "false". When true, non-admin users see a maintenance notice.',
  },
  ai_coach_mode: {
    label: "AI Coach mode",
    hint: 'Only "deterministic" is allowed. The coach is rule-based and uses real stored data only.',
  },
};

function settingValue(v: unknown): string {
  return typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v ?? null);
}

export default async function AdminSettingsPage() {
  const user = await requireAdmin();
  const configured = isSupabaseConfigured();
  const settings = configured
    ? await listSystemSettings(await createServerSupabaseClient())
    : [];

  return (
    <>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Admin</p>
          <h1 className="itg2-page-title mt-1">Settings</h1>
        </header>

        <section className="mt-6 itg2-card itg2-card-elevated p-4 sm:p-6">
          <h2 className="itg2-section-title">AI Coach configuration</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Coach mode</dt>
              <dd>Deterministic (rule-based, real stored data only)</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">External LLM connected</dt>
              <dd>No — no LLM provider is connected and no API key is stored.</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">LLM extension point</dt>
              <dd className="text-right">buildLlmCoachPrompt (uncalled, Phase 9)</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            Connecting an LLM is a future phase. Until then, no admin setting can claim one is
            connected.
          </p>
        </section>

        <section className="mt-6 sm:mt-8">
          <h2 className="itg2-section-title">System settings</h2>
          {settings.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {configured ? "No settings stored yet." : "Supabase is not connected yet, so no settings are listed."}
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {settings.map((s) => {
                const meta = SETTING_META[s.key];
                if (!meta) return null;
                return (
                  <li key={s.key} className="itg2-card itg2-card-flat p-4 sm:p-5">
                    <SettingForm
                      settingKey={s.key}
                      value={settingValue(s.value)}
                      label={meta.label}
                      hint={`${meta.hint} ${s.description ?? ""}`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
    </>
  );
}
