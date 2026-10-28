import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
import { WeeklyReviewForm } from "@/components/reviews/weekly-review-form";
import { getWeeklyReviews } from "@/lib/reviews/queries";
import { mondayOfWeek } from "@/lib/reviews/reviews";

export const metadata = { title: "Weekly Review — ITG TraderOS" };

/**
 * Weekly review page (Phase 8, spec §21, §27).
 *
 * The missing weekly-review flow from Phase 7: completing a
 * review awards +30 XP. The trader writes the reflection; the
 * week's aggregates are computed from the real trades when the
 * review is saved. A completed review also counts toward the
 * monthly certificate's review criterion.
 */
export default async function WeeklyReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const today = new Date().toISOString().slice(0, 10);
  const defaultWeekStart = mondayOfWeek(today) ?? today;

  let reviews = [] as Awaited<ReturnType<typeof getWeeklyReviews>>;
  if (configured) {
    const supabase = await createServerSupabaseClient();
    reviews = await getWeeklyReviews(supabase, user.id);
  }

  return (
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">Weekly Review</h1>
        <p className="mt-1 text-muted-foreground">
          Review the week honestly — what worked, what did not, and what to
          focus on next. Completing a review earns +30 XP, and the
          week&apos;s trades, P&L and win rate are filled in automatically
          from your journal.
        </p>

        <section className="mt-8 rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold">New weekly review</h2>
          {!configured ? (
            <p className="mt-2 text-muted-foreground">
              Supabase is not connected yet — weekly reviews will be saved
              once the database is connected. Nothing here is a demo.
            </p>
          ) : (
            <WeeklyReviewForm defaultWeekStart={defaultWeekStart} />
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Past reviews</h2>
          {reviews.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No weekly reviews yet. Complete your first one above.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-lg border bg-card p-4">
                  <p className="font-medium">
                    Week of {r.week_start_date} — {r.trades_count} trades
                    {r.total_pnl !== null ? ` · P&L ${r.total_pnl.toFixed(2)}` : ""}
                    {r.win_rate_pct !== null ? ` · Win rate ${r.win_rate_pct.toFixed(1)}%` : ""}
                  </p>
                  {r.best_strategy && (
                    <p className="text-sm text-muted-foreground">
                      Best: {r.best_strategy}
                      {r.worst_strategy ? ` · Worst: ${r.worst_strategy}` : ""}
                    </p>
                  )}
                  {r.main_mistake && (
                    <p className="mt-1 text-sm">
                      Main mistake: {r.main_mistake}
                    </p>
                  )}
                  {r.focus_next_week && (
                    <p className="text-sm">
                      Focus next week: {r.focus_next_week}
                    </p>
                  )}
                  {r.review_text && (
                    <p className="mt-2 text-sm text-muted-foreground">{r.review_text}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
