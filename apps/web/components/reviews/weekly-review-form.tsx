"use client";

import { useActionState } from "react";
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
 *
 * Master Web UI Redesign (Task 8) — PRESENTATION ONLY: fields
 * moved onto the v2 form system (.itg2-field / .itg2-label /
 * .itg2-input / .itg2-textarea, the same system as the risk
 * rules and trading plan forms), the submit is a native
 * .itg2-btn-primary button (the issue-certificate form
 * precedent for a standalone useActionState form), and the
 * result lines use the semantic .itg2-text-loss /
 * .itg2-text-profit tones. No field was added, removed,
 * renamed, reordered or given a new default — the full-form
 * inventory (weekStartDate, reviewText, mainMistake,
 * focusNextWeek) is exactly as before, because review saves
 * round-trip every field.
 */
export function WeeklyReviewForm({ defaultWeekStart }: { defaultWeekStart: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    saveWeeklyReviewAction,
    { ok: false },
  );
  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div className="itg2-field space-y-2">
        <label htmlFor="weekStartDate" className="itg2-label">
          Week starting (Monday)
        </label>
        <input
          id="weekStartDate"
          name="weekStartDate"
          type="date"
          defaultValue={defaultWeekStart}
          required
          className="itg2-input"
        />
      </div>
      <div className="itg2-field space-y-2">
        <label htmlFor="reviewText" className="itg2-label">
          How was your week?
        </label>
        <textarea
          id="reviewText"
          name="reviewText"
          rows={5}
          required
          placeholder="What went well, what went wrong, and why?"
          className="itg2-textarea"
        />
      </div>
      <div className="itg2-field space-y-2">
        <label htmlFor="mainMistake" className="itg2-label">
          Main mistake (optional)
        </label>
        <input
          id="mainMistake"
          name="mainMistake"
          type="text"
          maxLength={500}
          placeholder="e.g. Chased a breakout without confirmation"
          className="itg2-input"
        />
      </div>
      <div className="itg2-field space-y-2">
        <label htmlFor="focusNextWeek" className="itg2-label">
          Focus for next week (optional)
        </label>
        <input
          id="focusNextWeek"
          name="focusNextWeek"
          type="text"
          maxLength={500}
          placeholder="e.g. Wait for confirmation on every entry"
          className="itg2-input"
        />
      </div>
      <button type="submit" disabled={pending} className="itg2-btn-primary">
        {pending ? "Saving…" : "Complete weekly review (+30 XP)"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm itg2-text-loss">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="text-sm itg2-text-profit">
          {state.message}
        </p>
      )}
    </form>
  );
}
