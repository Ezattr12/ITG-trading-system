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
            <section className="hero-card mt-6 card-surface-raised card-glow-amber p-4 sm:p-6" aria-label="Achievement summary">
              <p className="eyebrow">Your collection</p>
              <p className="metric-hero tnum mt-1">
                <span className="text-gradient-gold">{unlockedIds.size}</span>
                <span className="text-muted-foreground"> of {bundle.achievements.length} unlocked</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {bundle.xpTotal} XP total from achievements
              </p>
            </section>
            <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Achievements">
              {bundle.achievements.map((achievement, i) => {
                const unlocked = unlockedIds.has(achievement.id);
                return (
                  <article
                    key={achievement.id}
                    className={`motion-reveal card-surface p-4 sm:p-5 ${unlocked ? "card-glow-amber" : "opacity-70"}`}
                    style={{ animationDelay: `${Math.min(i, 7) * 50}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h2 className="font-semibold">
                        {unlocked ? (
                          // Unlock check scales in (Phase 16) — a
                          // quiet mark, not a celebration. The
                          // "Unlocked" line below carries the fact.
                          <span aria-hidden="true" className="motion-scale-in inline-block text-emerald-400">
                            ✓{" "}
                          </span>
                        ) : (
                          "🔒 "
                        )}
                        {achievement.name}
                      </h2>
                      <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-sm font-medium text-amber-300 tnum">
                        +{achievement.xp_reward} XP
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {achievement.description ?? "No description."}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 font-medium">
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
            <Link href="/levels" className="mt-6 inline-block text-sm font-medium underline">
              View your level and score breakdown
            </Link>
          </>
        )}
    </AppShell>
  );
}
