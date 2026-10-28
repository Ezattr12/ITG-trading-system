"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { refreshCoachAnalysisAction } from "@/lib/coach/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Refresh the weekly coach analysis (Phase 9, spec §28).
 *
 * Recomputes the analysis from the week's real trades and
 * stores only insights that are new or changed — a refresh
 * with unchanged data stores nothing, and the result message
 * says so.
 */
export function RefreshCoachForm({ defaultWeekStart }: { defaultWeekStart: string }) {
  const [state, formAction, pending] = useActionState<
    ActionResult & { inserted?: number; skipped?: number },
    FormData
  >(refreshCoachAnalysisAction, { ok: false });
  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-4">
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
          className="mt-1 block h-11 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? (
          <>
            {/* Generating state (Phase 16): a soft purple pulse
                beside "Analysing…" — the text says what is
                happening, the pulse only softens the wait. */}
            <span aria-hidden="true" className="motion-ai-dot inline-block h-2 w-2 rounded-full bg-ai" />
            Analysing…
          </>
        ) : (
          "Refresh analysis"
        )}
      </Button>
      {state.error && <p className="motion-fade-in w-full text-sm text-red-400">{state.error}</p>}
      {state.message && <p className="motion-fade-in w-full text-sm text-emerald-400">{state.message}</p>}
    </form>
  );
}
