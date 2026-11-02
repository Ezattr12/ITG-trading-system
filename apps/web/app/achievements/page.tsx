import { redirect } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { getGamificationBundle } from "@/lib/gamification/queries";
import { refreshGamification } from "@/lib/gamification/service";
import { describeCriteria } from "@/lib/gamification/achievements";
import { createNotification } from "@/lib/discipline/service";

export const metadata = { title: "Achievements — ITG TraderOS" };

/**
 * Achievements page (Phase 7, spec §25). Every achievement in
 * the catalogue is listed with its earned/locked state from the
 * trader's real data — nothing is shown as earned that was not.
 * New achievements are config rows in the `achievements` table,
 * not code changes. Visiting the page awards any newly earned
 * achievements (best-effort).
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * the page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, the summary as the .itg2-hero
 * with the unlocked count in gold, earned cards on
 * .itg2-card with the .itg2-card-gold emphasis and locked
 * cards muted on the plain card, the XP and category pills
 * as .itg2-chip variants, the lock emoji replaced by the
 * lucide Lock icon). All data, copy, the refresh +
 * notification side effects and empty states are exactly
 * as before.
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
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Achievements</p>
          <h1 className="itg2-page-title mt-1">Achievements</h1>
          <p className="mt-2 text-muted-foreground">
            Earned by doing the work — journaling, discipline, risk management, goals
            and consistency. Each unlocked achievement awards its own XP.
          </p>
        </header>

        {bundle === null ? (
          <p className="itg2-notice itg2-notice-neutral mt-6 sm:mt-8">
            Supabase is not connected yet — your achievements will be checked against
            your real trades once the database is connected. Nothing here is estimated.
          </p>
        ) : bundle.achievements.length === 0 ? (
          <p className="itg2-notice itg2-notice-neutral mt-6 sm:mt-8">
            No achievements are configured yet. An admin adds them to the achievements
            table — no code change is needed.
          </p>
        ) : (
          <>
            <section className="itg2-hero mt-6" aria-label="Achievement summary">
              <div className="itg2-hero-inner p-5 sm:p-7">
                <p className="itg2-eyebrow">Your collection</p>
                <p className="itg2-hero-value tnum mt-1">
                  <span className="itg2-text-gold">{unlockedIds.size}</span>
                  <span className="text-muted-foreground"> of {bundle.achievements.length} unlocked</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {bundle.xpTotal} XP total from achievements
                </p>
              </div>
            </section>
            <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Achievements">
              {bundle.achievements.map((achievement, i) => {
                const unlocked = unlockedIds.has(achievement.id);
                return (
                  <article
                    key={achievement.id}
                    className={`motion-reveal itg2-card p-4 sm:p-5 ${unlocked ? "itg2-card-gold" : "opacity-70"}`}
                    style={{ animationDelay: `${Math.min(i, 7) * 50}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h2 className="font-semibold">
                        {unlocked ? (
                          // Unlock check scales in (Phase 16) — a
                          // quiet mark, not a celebration. The
                          // "Unlocked" line below carries the fact.
                          <span aria-hidden="true" className="motion-scale-in inline-block itg2-text-gold">
                            ✓{" "}
                          </span>
                        ) : (
                          <span aria-hidden="true" className="inline-block align-[-2px] text-muted-foreground">
                            <Lock className="h-4 w-4" />{" "}
                          </span>
                        )}
                        {achievement.name}
                      </h2>
                      <span className="itg2-chip itg2-chip-gold shrink-0 tnum">
                        +{achievement.xp_reward} XP
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {achievement.description ?? "No description."}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="itg2-chip itg2-chip-muted">
                        {CATEGORY_LABELS[achievement.category] ?? achievement.category}
                      </span>
                      <span>{describeCriteria(achievement.criteria)}</span>
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
            <Link href="/levels" className="itg2-link mt-6">
              View your level and score breakdown
            </Link>
          </>
        )}
    </AppShell>
  );
}
