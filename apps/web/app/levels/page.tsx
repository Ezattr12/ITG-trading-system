import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { getGamificationBundle } from "@/lib/gamification/queries";
import { refreshGamification } from "@/lib/gamification/actions";
import { progressToNextLevel } from "@/lib/gamification/scoring";
import { createNotification } from "@/lib/discipline/actions";
import { XpHistoryChart } from "@/components/analytics/charts";
import { ProgressBar } from "@/components/analytics/stat-card";
import { CountUpDecimal, CountUpXp } from "@/components/analytics/count-up";

export const metadata = { title: "Levels — ITG TraderOS" };

/**
 * Levels page (Phase 7, spec §8, §24–26). The trader's level is
 * a multi-dimensional score — discipline, risk, journal
 * consistency, goal completion, psychology, strategy execution,
 * consistency, performance — computed from their real stored
 * data, never from profit alone and never fabricated. A
 * dimension with no data yet is shown as "No data yet", not
 * scored as 0. Visiting the page also stores the current score
 * and awards any newly earned achievements (best-effort).
 */

export default async function LevelsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  let bundle = null as Awaited<ReturnType<typeof getGamificationBundle>> | null;
  let progress = null as ReturnType<typeof progressToNextLevel>;
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
    if (
      gamification.currentLevel !== null &&
      gamification.previousLevel !== null &&
      gamification.currentLevel !== gamification.previousLevel
    ) {
      await createNotification({
        userId: user.id,
        type: "level_up",
        title: `Level up: ${gamification.currentLevel}`,
        body: `Your multi-dimensional score reached the ${gamification.currentLevel} level.`,
      });
    }
    bundle = await getGamificationBundle(supabase, user.id);
    progress = progressToNextLevel(bundle.score.score, bundle.levels);
  }

  return (
    <AppShell email={user.email}>
        <h1 className="page-title">Trader level</h1>
        <p className="page-lede">
          Your level is scored on discipline, risk, journaling, goals, psychology,
          strategy, consistency and performance — not profit alone. Performance is
          only 5% of the score.
        </p>

        {bundle === null ? (
          <p className="mt-6 sm:mt-8 text-muted-foreground">
            Supabase is not connected yet — your level will be calculated from your
            real trades once the database is connected. Nothing here is estimated.
          </p>
        ) : bundle.score.score === null ? (
          <section className="hero-card mt-6 sm:mt-8 card-surface-raised p-4 sm:p-6">
            <h2 className="section-title">No level yet</h2>
            <p className="mt-2 text-muted-foreground">
              Journal your first trade, set your risk rules and create a goal — your
              level is calculated from what you actually do, so there is nothing to
              show until then.
            </p>
            <div className="mt-4 flex gap-4">
              <Link href="/trades/new" className="text-sm font-medium underline">Add a trade</Link>
              <Link href="/goals" className="text-sm font-medium underline">Create a goal</Link>
              <Link href="/risk" className="text-sm font-medium underline">Set risk rules</Link>
            </div>
          </section>
        ) : (
          <>
            <section className="motion-reveal mt-6 sm:mt-8 grid gap-4 sm:grid-cols-3" aria-label="Level summary">
              {/* Current level is the hero of this page: raised,
                  gold glow, gradient level name — premium status
                  earned from real multi-dimensional scoring. */}
              <article className="hero-card card-surface-raised card-glow-amber p-4 sm:p-5">
                <h2 className="text-sm font-medium text-muted-foreground">Current level</h2>
                <p className="metric-hero text-gradient-gold mt-2">{bundle.score.levelName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Score <CountUpDecimal value={bundle.score.score} decimals={1} /> / 100
                </p>
              </article>
              <article className="card-surface p-4 sm:p-5">
                <h2 className="text-sm font-medium text-muted-foreground">Next level</h2>
                <p className="mt-2 text-xl font-semibold">{progress?.nextLevel ?? "Top level reached"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {progress?.pointsToNext === null
                    ? "You hold the highest level."
                    : `${progress?.pointsToNext} points to go`}
                </p>
              </article>
              <article className="card-surface p-4 sm:p-5">
                <h2 className="text-sm font-medium text-muted-foreground">Total XP</h2>
                {/* XP counts up (Phase 16) — XP rewards discipline,
                    journaling and reviews, and the count-up marks
                    the total without flashing a reward. */}
                <p className="mt-2 text-xl font-semibold">
                  <CountUpXp value={bundle.xpTotal} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Earned for journaling, goals, reviews and discipline.
                </p>
              </article>
            </section>

            {progress !== null && progress.nextLevel !== null ? (
              <section className="motion-reveal motion-reveal-1 mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Progress to next level">
                <h2 className="section-title">Progress to {progress.nextLevel}</h2>
                <div className="mt-4">
                  <ProgressBar
                    percent={progress.progressPct}
                    label={`${progress.progressPct.toFixed(0)}% through ${progress.currentLevel} — ${progress.pointsToNext} points to ${progress.nextLevel}`}
                  />
                </div>
              </section>
            ) : null}

            <section className="motion-reveal motion-reveal-2 mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Score breakdown">
              <h2 className="section-title">Score breakdown</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each dimension is scored 0–100 from your real data. Dimensions with no
                data yet are not counted — they do not drag your score down.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Dimension</th>
                      <th className="py-2 pr-4 font-medium">Score</th>
                      <th className="py-2 font-medium">Weight</th>
                    </tr>
                  </thead>
                  <tbody className="list-divider">
                    {bundle.score.dimensions.map((d) => (
                      <tr key={d.key} className="list-row-premium">
                        <td className="py-2 pr-4">{d.label}</td>
                        <td className="py-2 pr-4 tnum">
                          {d.value === null ? "No data yet" : `${d.value.toFixed(0)} / 100`}
                        </td>
                        <td className="py-2 tnum">{(d.weight * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="motion-reveal motion-reveal-3 mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="XP history">
              <h2 className="section-title">XP over time</h2>
              {bundle.xpHistory.length === 0 ? (
                <p className="mt-2 text-muted-foreground">
                  No XP yet — journal a trade or complete a goal to earn your first XP.
                </p>
              ) : (
                <div className="mt-4">
                  <div className="chart-panel">
                    <XpHistoryChart data={bundle.xpHistory} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Cumulative XP from your xp_transactions. Each point is one XP event.
                  </p>
                </div>
              )}
            </section>

            <section className="motion-reveal motion-reveal-4 mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="All levels">
              <h2 className="section-title">Levels</h2>
              <ul className="mt-3 list-divider text-sm">
                {bundle.levels.map((level) => {
                  const isCurrent = level.name === bundle?.score.levelName;
                  return (
                    <li key={level.id} className="list-row-premium flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <strong className={isCurrent ? "text-gradient-gold" : ""}>{level.name}</strong>
                        {isCurrent ? (
                          <span className="ml-2 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                            Current
                          </span>
                        ) : null}
                        {level.description ? ` — ${level.description}` : ""}
                      </span>
                      <span className="text-muted-foreground tnum">
                        {level.min_score}–{level.max_score === null ? "∞" : level.max_score}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Thresholds and weights are configurable by an admin in the levels table.
              </p>
              <Link href="/achievements" className="mt-4 inline-block text-sm font-medium underline">
                View achievements
              </Link>
            </section>
          </>
        )}
    </AppShell>
  );
}
