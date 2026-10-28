"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
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
 */
export function MarkNotificationReadForm({ notificationId }: { notificationId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    markNotificationReadAction,
    { ok: false },
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Mark read"}
      </Button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-300">
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
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Mark all as read"}
      </Button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="mt-1 text-xs text-emerald-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
