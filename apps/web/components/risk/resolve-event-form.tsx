"use client";

import { useActionState } from "react";
import { resolveRiskEventAction } from "@/lib/risk/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Resolve button for one risk event (Phase 5).
 *
 * A plain <form action={...}> cannot take a (prev, formData)
 * Server Action, so this client wrapper uses useActionState
 * instead and shows the action's error inline.
 *
 * Master Web UI Redesign (Task 7) — PRESENTATION ONLY: the
 * submit is a native button on .itg2-btn-ghost (the converted
 * forms pattern) and the inline error uses .itg2-text-loss.
 * Labels, the pending state and the action are exactly as
 * before.
 */
export function ResolveEventForm({ eventId }: { eventId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    resolveRiskEventAction,
    { ok: false },
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="eventId" value={eventId} />
      <button type="submit" className="itg2-btn-ghost" disabled={pending}>
        {pending ? "Saving…" : "Mark resolved"}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs itg2-text-loss">
          {state.error}
        </p>
      )}
    </form>
  );
}
