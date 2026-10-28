"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { saveWeeklyReviewAction } from "@/lib/reviews/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Weekly review form (Phase 8, spec §21, §27).
 *
 * The trader writes only the reflection — review text, main
 * mistake, focus for next week. The week's trades, P&L, win
 * rate, journal completion and best/worst strategy are computed
 * server-side from the real trades. Completing a review awards
 * +30 XP through the existing awardXp path (idempotent per
 * review, so re-saving never double-awards).
 */
export function WeeklyReviewForm({ defaultWeekStart }: { defaultWeekStart: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    saveWeeklyReviewAction,
    { ok: false },
  );
  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div>
        <label htmlFor="weekStartDate" className="text-sm font-medium">
          Week starting (Monday)
        </label>
        <input
          id="weekStartDate"
          name="weekStartDate"
          type="date"
          defaultValue={defaultWeekStart}
          required
          className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="reviewText" className="text-sm font-medium">
          How was your week?
        </label>
        <textarea
          id="reviewText"
          name="reviewText"
          rows={5}
          required
          placeholder="What went well, what went wrong, and why?"
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="mainMistake" className="text-sm font-medium">
          Main mistake (optional)
        </label>
        <input
          id="mainMistake"
          name="mainMistake"
          type="text"
          maxLength={500}
          placeholder="e.g. Chased a breakout without confirmation"
          className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="focusNextWeek" className="text-sm font-medium">
          Focus for next week (optional)
        </label>
        <input
          id="focusNextWeek"
          name="focusNextWeek"
          type="text"
          maxLength={500}
          placeholder="e.g. Wait for confirmation on every entry"
          className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Complete weekly review (+30 XP)"}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="text-sm text-emerald-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
