import { getCurrentUser } from "@/lib/auth/session";
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
 */
export default async function AdminAchievementsPage() {
  const user = await getCurrentUser();
  const configured = isSupabaseConfigured();
  const achievements = configured
    ? await listAdminAchievements(await createServerSupabaseClient())
    : [];

  return (
    <>
        <h1 className="page-title">Achievements</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {achievements.length} achievement{achievements.length === 1 ? "" : "s"} configured.
          Changes apply to the catalogue immediately; already-unlocked achievements are not
          taken away.
        </p>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
          <h2 className="section-title">Create achievement</h2>
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
              <li key={a.id} className="list-row-premium card-surface p-4 sm:p-5">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span>{a.name}</span>
                  <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {a.slug}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {a.category}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300 tnum">
                    {a.xp_reward} XP
                  </span>
                </p>
                {a.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
                ) : null}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
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
