"use client";

import { useActionState } from "react";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/discipline/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Mark-as-read buttons for notifications (Phase 6, spec §30).
 * Compact client wrappers (same pattern as Phase 5's
 * ResolveEventForm): a plain form cannot take a
 * (prev, formData) Server Action.
 *
 * Task 9: the submit buttons moved onto the v2 ghost button
 * (the ResolveEventForm precedent), which also restores a
 * ≥44px touch target. Bindings, fields and copy are unchanged.
 */
export function MarkNotificationReadForm({ notificationId }: { notificationId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    markNotificationReadAction,
    { ok: false },
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="notificationId" value={notificationId} />
      <button type="submit" className="itg2-btn-ghost" disabled={pending}>
        {pending ? "Saving…" : "Mark read"}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs itg2-text-loss">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function MarkAllNotificationsReadForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    markAllNotificationsReadAction,
    { ok: false },
  );
  return (
    <form action={formAction}>
      <button type="submit" className="itg2-btn-ghost" disabled={pending}>
        {pending ? "Saving…" : "Mark all as read"}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs itg2-text-loss">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="mt-1 text-xs itg2-text-profit">
          {state.message}
        </p>
      )}
    </form>
  );
}
