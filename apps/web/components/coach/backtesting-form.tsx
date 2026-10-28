"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { logBacktestingSessionAction } from "@/lib/coach/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Log backtesting sessions (Phase 9, spec §24).
 *
 * Records the TOTAL sessions done on a day and awards +15 XP
 * per session through the existing awardXp path. Re-submitting
 * the same total awards nothing new; raising the total awards
 * only the new sessions.
 */
export function BacktestingForm({ defaultDate }: { defaultDate: string }) {
  const [state, formAction, pending] = useActionState<
    ActionResult & { sessionsAwarded?: number },
    FormData
  >(logBacktestingSessionAction, { ok: false });
  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="activityDate" className="text-sm font-medium">
          Date
        </label>
        <input
          id="activityDate"
          name="activityDate"
          type="date"
          defaultValue={defaultDate}
          required
          className="mt-1 block h-11 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="sessions" className="text-sm font-medium">
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
          className="mt-1 block h-11 w-24 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Logging…" : "Log backtesting (+15 XP per session)"}
      </Button>
      {state.error && <p className="w-full text-sm text-red-400">{state.error}</p>}
      {state.message && <p className="w-full text-sm text-emerald-400">{state.message}</p>}
    </form>
  );
}
