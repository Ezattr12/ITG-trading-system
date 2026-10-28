import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { getGamificationBundle } from "@/lib/gamification/queries";
import { refreshGamification } from "@/lib/gamification/actions";
import { describeCriteria } from "@/lib/gamification/achievements";
import { createNotification } from "@/lib/discipline/actions";

export const metadata = { title: "Achievements — ITG TraderOS" };

/**
 * Achievements page (Phase 7, spec §25). Every achievement in
 * the catalogue is listed with its earned/locked state from the
 * trader's real data — nothing is shown as earned that was not.
 * New achievements are config rows in the `achievements` table,
 * not code changes. Visiting the page awards any newly earned
 * achievements (best-effort).
 */

const CATEGORY_LABELS: Record<string, string> = {
  trades: "Trades",
  discipline: "Discipline",
  journal: "Journal",
  risk: "Risk",
  backtesting: "Backtesting",
  goals: "Goals",
  consistency: "Consistency",
  other: "Other",
};

export default async function AchievementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  let bundle = null as Awaited<ReturnType<typeof getGamificationBundle>> | null;
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    const gamification = await refreshGamification(supabase, user.id);
    for (const achievement of gamification.unlocked) {
      await createNotification({
        userId: user.id,
        type: "achievement",
        title: `Achievement unlocked: ${achievement.name}`,
        body: achievement.description ?? `You earned ${achievement.xp_reward} XP.`,
        relatedEntityType: "achievement",
        relatedEntityId: achievement.id,
      });
    }
    bundle = await getGamificationBundle(supabase, user.id);
  }

  const unlockedIds = new Set(
    (bundle?.userAchievements ?? []).map((u) => u.achievement_id),
  );
  const unlockedAt = new Map(
    (bundle?.userAchievements ?? []).map((u) => [u.achievement_id, u.unlocked_at]),
  );

  return (
    <AppShell email={user.email}>
        <h1 className="page-title">Achievements</h1>
        <p className="page-lede">
          Earned by doing the work — journaling, discipline, risk management, goals
          and consistency. Each unlocked achievement awards its own XP.
        </p>

        {bundle === null ? (
          <p className="mt-6 sm:mt-8 text-muted-foreground">
            Supabase is not connected yet — your achievements will be checked against
            your real trades once the database is connected. Nothing here is estimated.
          </p>
        ) : bundle.achievements.length === 0 ? (
          <p className="mt-6 sm:mt-8 text-muted-foreground">
            No achievements are configured yet. An admin adds them to the achievements
            table — no code change is needed.
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-muted-foreground">
              {unlockedIds.size} of {bundle.achievements.length} unlocked ·{" "}
              {bundle.xpTotal} XP total
            </p>
            <section className="mt-4 grid gap-4 sm:grid-cols-2" aria-label="Achievements">
              {bundle.achievements.map((achievement) => {
                const unlocked = unlockedIds.has(achievement.id);
                return (
                  <article
                    key={achievement.id}
                    className={`card-surface p-4 ${unlocked ? "" : "opacity-70"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h2 className="font-semibold">
                        {unlocked ? "✓ " : "🔒 "}
                        {achievement.name}
                      </h2>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        +{achievement.xp_reward} XP
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {achievement.description ?? "No description."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {CATEGORY_LABELS[achievement.category] ?? achievement.category} ·{" "}
                      {describeCriteria(achievement.criteria)}
                    </p>
                    <p className="mt-2 text-xs font-medium">
                      {unlocked
                        ? `Unlocked ${new Date(unlockedAt.get(achievement.id) as string).toLocaleDateString()}`
                        : "Locked — not earned yet"}
                    </p>
                  </article>
                );
              })}
            </section>
            <Link href="/levels" className="mt-6 inline-block text-sm font-medium underline">
              View your level and score breakdown
            </Link>
          </>
        )}
    </AppShell>
  );
}
