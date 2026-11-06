"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/auth/actions";
import {
  processDeletionRequestAction,
  type DeletionDecision,
} from "@/lib/account/actions";

/**
 * Admin deletion-request controls (Google Play release
 * preparation) — the Process / Dismiss pair rendered for each
 * pending row on /admin/deletion-requests.
 *
 * processDeletionRequestAction takes (requestId, decision),
 * not the (prev, FormData) shape the shared ActionForm
 * drives, so — the resolve-event-form pattern — these client
 * wrappers use useActionState directly and render the same
 * error / success / pending treatment. The action does not
 * revalidate the queue page, so a successful decision
 * refreshes the route to show the row's new state.
 */
function DecisionForm({
  requestId,
  decision,
  submitLabel,
  submitClassName,
  children,
}: {
  requestId: string;
  decision: DeletionDecision;
  submitLabel: string;
  submitClassName: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async () => processDeletionRequestAction(requestId, decision),
    { ok: false },
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-3">
      {state.error && (
        <p role="alert" className="motion-fade-in flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="motion-fade-in flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <CheckCircle2 className="motion-scale-in mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </p>
      )}
      {children}
      <button type="submit" className={submitClassName} disabled={pending} aria-busy={pending}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Please wait…
          </>
        ) : (
          submitLabel
        )}
      </button>
    </form>
  );
}

export function DeletionRequestControls({ requestId }: { requestId: string }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <DecisionForm
        requestId={requestId}
        decision="process"
        submitLabel="Process — delete the account"
        submitClassName="itg2-btn-danger w-full"
      >
        <p className="text-xs text-muted-foreground">
          Deletes the account registered with this email address, permanently, through the
          same deletion core as the in-app path. If no account matches the email, the request
          is closed and the outcome recorded on it.
        </p>
      </DecisionForm>
      <DecisionForm
        requestId={requestId}
        decision="dismiss"
        submitLabel="Dismiss request"
        submitClassName="itg2-btn-ghost w-full"
      >
        <p className="text-xs text-muted-foreground">
          Closes the request without deleting anything — for duplicates, mistakes, or requests
          already handled another way.
        </p>
      </DecisionForm>
    </div>
  );
}
