"use client";

import { useActionState } from "react";
import { refreshCoachAnalysisAction } from "@/lib/coach/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Refresh the weekly coach analysis (Phase 9, spec §28).
 *
 * Recomputes the analysis from the week's real trades and
 * stores only insights that are new or changed — a refresh
 * with unchanged data stores nothing, and the result message
 * says so.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION
 * ONLY: the form moved onto the v2 form system
 * (.itg2-label / .itg2-input) and the submit is a native
 * button on .itg2-btn-ai — violet, because refreshing the
 * analysis IS the AI action (the class carries its full
 * box/type/paint in the unlayered tail of itg2.css, like
 * the other v2 form submits). The result lines use the
 * semantic .itg2-text-loss / .itg2-text-profit tones. The
 * action, the field and the pending content are exactly
 * as before.
 */
export function RefreshCoachForm({ defaultWeekStart }: { defaultWeekStart: string }) {
  const [state, formAction, pending] = useActionState<
    ActionResult & { inserted?: number; skipped?: number },
    FormData
  >(refreshCoachAnalysisAction, { ok: false });
  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="weekStartDate" className="itg2-label">
          Week starting (Monday)
        </label>
        <input
          id="weekStartDate"
          name="weekStartDate"
          type="date"
          defaultValue={defaultWeekStart}
          required
          className="mt-1 block itg2-input"
        />
      </div>
      <button type="submit" disabled={pending} aria-busy={pending} className="itg2-btn-ai">
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
      </button>
      {state.error && <p className="motion-fade-in w-full text-sm itg2-text-loss">{state.error}</p>}
      {state.message && <p className="motion-fade-in w-full text-sm itg2-text-profit">{state.message}</p>}
    </form>
  );
}
