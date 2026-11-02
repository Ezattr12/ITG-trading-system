"use client";

import { useActionState } from "react";
import { logBacktestingSessionAction } from "@/lib/coach/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Log backtesting sessions (Phase 9, spec §24).
 *
 * Records the TOTAL sessions done on a day and awards +15 XP
 * per session through the existing awardXp path. Re-submitting
 * the same total awards nothing new; raising the total awards
 * only the new sessions.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION
 * ONLY: the form moved onto the v2 form system
 * (.itg2-label / .itg2-input) and the submit is a native
 * button on .itg2-btn-primary — blue, not violet, because
 * logging a session is a journal action, not an AI action.
 * The result lines use the semantic .itg2-text-loss /
 * .itg2-text-profit tones. The action, the fields and the
 * +15 XP wiring are exactly as before.
 */
export function BacktestingForm({ defaultDate }: { defaultDate: string }) {
  const [state, formAction, pending] = useActionState<
    ActionResult & { sessionsAwarded?: number },
    FormData
  >(logBacktestingSessionAction, { ok: false });
  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="activityDate" className="itg2-label">
          Date
        </label>
        <input
          id="activityDate"
          name="activityDate"
          type="date"
          defaultValue={defaultDate}
          required
          className="mt-1 block itg2-input"
        />
      </div>
      <div>
        <label htmlFor="sessions" className="itg2-label">
          Backtesting sessions today (total)
        </label>
        <input
          id="sessions"
          name="sessions"
          type="number"
          min={1}
          max={10}
          defaultValue={1}
          required
          className="mt-1 block itg2-input"
        />
      </div>
      <button type="submit" disabled={pending} className="itg2-btn-primary">
        {pending ? "Logging…" : "Log backtesting (+15 XP per session)"}
      </button>
      {state.error && <p className="w-full text-sm itg2-text-loss">{state.error}</p>}
      {state.message && <p className="w-full text-sm itg2-text-profit">{state.message}</p>}
    </form>
  );
}
