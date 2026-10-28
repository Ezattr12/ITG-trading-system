import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
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
      <AppHeader email={user?.email ?? null} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">Achievements</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {achievements.length} achievement{achievements.length === 1 ? "" : "s"} configured.
          Changes apply to the catalogue immediately; already-unlocked achievements are not
          taken away.
        </p>

        <section className="mt-8 rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold">Create achievement</h2>
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
              <li key={a.id} className="rounded-lg border bg-card p-4">
                <p className="font-medium">
                  {a.name} · {a.slug} · {a.category} · {a.xp_reward} XP
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
      </main>
    </>
  );
}
