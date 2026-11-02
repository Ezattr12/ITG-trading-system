import { ChevronDown } from "lucide-react";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { listAdminAchievements } from "@/lib/admin/queries";
import { AchievementForm } from "@/components/admin/admin-forms";

export const metadata = { title: "Admin — Achievements — ITG TraderOS" };

/**
 * Admin achievement management (Phase 10). The seeded catalogue
 * is editable here — add a new achievement or change an existing
 * one's name, category or XP reward — without a code change.
 * Every save is audit-logged.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * flat header band, the create panel and catalogue rows as
 * v2 cards (flat where they contain forms), the slug /
 * category / XP pills as .itg2-chip variants (XP in gold),
 * and the Edit disclosure on the shared .itg2-details-summary
 * pattern. The query, forms and copy are exactly as before.
 */
export default async function AdminAchievementsPage() {
  const user = await requireAdmin();
  const configured = isSupabaseConfigured();
  const achievements = configured
    ? await listAdminAchievements(await createServerSupabaseClient())
    : [];

  return (
    <>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Admin</p>
          <h1 className="itg2-page-title mt-1">Achievements</h1>
          <p className="mt-2 text-muted-foreground">
            {achievements.length} achievement{achievements.length === 1 ? "" : "s"} configured.
            Changes apply to the catalogue immediately; already-unlocked achievements are not
            taken away.
          </p>
        </header>

        <section className="mt-6 sm:mt-8 itg2-card itg2-card-flat p-4 sm:p-6">
          <h2 className="itg2-section-title">Create achievement</h2>
          <div className="mt-4">
            <AchievementForm />
          </div>
        </section>

        {achievements.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {configured ? "No achievements configured yet." : "Supabase is not connected yet, so no achievements are listed."}
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {achievements.map((a) => (
              <li key={a.id} className="itg2-card p-4 sm:p-5">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span>{a.name}</span>
                  <span className="itg2-chip itg2-chip-muted">
                    {a.slug}
                  </span>
                  <span className="itg2-chip itg2-chip-muted">
                    {a.category}
                  </span>
                  <span className="itg2-chip itg2-chip-gold tnum">
                    {a.xp_reward} XP
                  </span>
                </p>
                {a.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
                ) : null}
                <details className="mt-3">
                  <summary className="itg2-details-summary">
                    Edit
                    <ChevronDown className="itg2-details-chevron h-4 w-4" aria-hidden="true" />
                  </summary>
                  <div className="mt-4">
                    <AchievementForm achievement={a} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
