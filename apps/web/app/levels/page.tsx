import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { getGamificationBundle } from "@/lib/gamification/queries";
import { isGenuineLevelUp, refreshGamification } from "@/lib/gamification/service";
import { progressToNextLevel } from "@/lib/gamification/scoring";
import { createNotification } from "@/lib/discipline/service";
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
 *
 * Master Web UI Redesign (Task 5) — PRESENTATION ONLY: the
 * page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, the level summary as .itg2-kpi
 * cards with the level name in gold and XP in plain white,
 * the shared ProgressBar re-scoped by .itg2-goalbar-scope,
 * the score breakdown as an .itg2-table, the shared XP chart
 * re-scoped blue -> cyan by .itg2-xp-scope — XP is not AI, so
 * no violet anywhere — and the level ladder on .itg2-row with
 * a gold Current chip). All data, copy, score expressions and
 * empty states are exactly as before, including the
 * null-score "No level yet" state.
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
    if (isGenuineLevelUp(gamification)) {
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
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Levels</p>
          <h1 className="itg2-page-title mt-1">Trader level</h1>
          <p className="mt-2 text-muted-foreground">
            Your level is scored on discipline, risk, journaling, goals, psychology,
            strategy, consistency and performance — not profit alone. Performance is
            only 5% of the score.
          </p>
        </header>

        {bundle === null ? (
          <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
            <p className="text-muted-foreground">
              Supabase is not connected yet — your level will be calculated from your
              real trades once the database is connected. Nothing here is estimated.
            </p>
          </section>
        ) : bundle.score.score === null ? (
          <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
            <h2 className="itg2-section-title">No level yet</h2>
            <p className="mt-2 text-muted-foreground">
              Journal your first trade, set your risk rules and create a goal — your
              level is calculated from what you actually do, so there is nothing to
              show until then.
            </p>
            <div className="mt-4 flex gap-4">
              <Link href="/trades/new" className="itg2-link text-sm font-medium">Add a trade</Link>
              <Link href="/goals" className="itg2-link text-sm font-medium">Create a goal</Link>
              <Link href="/risk" className="itg2-link text-sm font-medium">Set risk rules</Link>
            </div>
          </section>
        ) : (
          <>
            <section className="motion-reveal mt-6 sm:mt-8 grid gap-4 sm:grid-cols-3" aria-label="Level summary">
              {/* Current level is the hero of this page: elevated
                  glass, the level name in gold — premium status
                  earned from real multi-dimensional scoring. */}
              <article className="itg2-card itg2-card-elevated itg2-kpi">
                <h2 className="itg2-kpi-label">Current level</h2>
                <p className="itg2-kpi-value">
                  <span className="itg2-text-gold">{bundle.score.levelName}</span>
                </p>
                <p className="itg2-kpi-hint">
                  Score <CountUpDecimal value={bundle.score.score} decimals={1} /> / 100
                </p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Next level</h2>
                <p className="itg2-kpi-value">{progress?.nextLevel ?? "Top level reached"}</p>
                <p className="itg2-kpi-hint">
                  {progress?.pointsToNext === null
                    ? "You hold the highest level."
                    : `${progress?.pointsToNext} points to go`}
                </p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Total XP</h2>
                {/* XP counts up (Phase 16) — XP rewards discipline,
                    journaling and reviews, and the count-up marks
                    the total without flashing a reward. XP stays
                    plain white in v2: it is not AI. */}
                <p className="itg2-kpi-value">
                  <CountUpXp value={bundle.xpTotal} />
                </p>
                <p className="itg2-kpi-hint">
                  Earned for journaling, goals, reviews and discipline.
                </p>
              </article>
            </section>

            {progress !== null && progress.nextLevel !== null ? (
              <section className="motion-reveal motion-reveal-1 itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Progress to next level">
                <h2 className="itg2-section-title">Progress to {progress.nextLevel}</h2>
                <div className="itg2-goalbar-scope mt-4">
                  <ProgressBar
                    percent={progress.progressPct}
                    label={`${progress.progressPct.toFixed(0)}% through ${progress.currentLevel} — ${progress.pointsToNext} points to ${progress.nextLevel}`}
                  />
                </div>
              </section>
            ) : null}

            <section className="motion-reveal motion-reveal-2 itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Score breakdown">
              <h2 className="itg2-section-title">Score breakdown</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each dimension is scored 0–100 from your real data. Dimensions with no
                data yet are not counted — they do not drag your score down.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="itg2-table itg2-table-fit">
                  <thead>
                    <tr>
                      <th>Dimension</th>
                      <th>Score</th>
                      <th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.score.dimensions.map((d) => (
                      <tr key={d.key}>
                        <td>{d.label}</td>
                        <td className="tnum">
                          {d.value === null ? "No data yet" : `${d.value.toFixed(0)} / 100`}
                        </td>
                        <td className="tnum">{(d.weight * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="motion-reveal motion-reveal-3 itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="XP history">
              <h2 className="itg2-section-title">XP over time</h2>
              {bundle.xpHistory.length === 0 ? (
                <p className="mt-2 text-muted-foreground">
                  No XP yet — journal a trade or complete a goal to earn your first XP.
                </p>
              ) : (
                <div className="mt-4">
                  <div className="itg2-xp-scope">
                    <XpHistoryChart data={bundle.xpHistory} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Cumulative XP from your xp_transactions. Each point is one XP event.
                  </p>
                </div>
              )}
            </section>

            <section className="motion-reveal motion-reveal-4 itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="All levels">
              <h2 className="itg2-section-title">Levels</h2>
              <ul className="mt-3 text-sm">
                {bundle.levels.map((level) => {
                  const isCurrent = level.name === bundle?.score.levelName;
                  return (
                    <li key={level.id} className="itg2-row flex-wrap gap-2">
                      <span>
                        <strong className={isCurrent ? "itg2-text-gold" : ""}>{level.name}</strong>
                        {isCurrent ? (
                          <span className="itg2-chip itg2-chip-gold ml-2">
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
              <Link href="/achievements" className="itg2-link mt-4 inline-block text-sm font-medium">
                View achievements
              </Link>
            </section>
          </>
        )}
    </AppShell>
  );
}
