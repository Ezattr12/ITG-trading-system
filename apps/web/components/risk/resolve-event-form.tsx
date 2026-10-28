"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { resolveRiskEventAction } from "@/lib/risk/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Resolve button for one risk event (Phase 5).
 *
 * A plain <form action={...}> cannot take a (prev, formData)
 * Server Action, so this client wrapper uses useActionState
 * instead and shows the action's error inline.
 */
export function ResolveEventForm({ eventId }: { eventId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    resolveRiskEventAction,
    { ok: false },
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="eventId" value={eventId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Mark resolved"}
      </Button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
