"use client";

import { useActionState, type ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/auth/actions";
import {
  deleteOwnAccountAction,
  requestDeletionAction,
} from "@/lib/account/actions";

/**
 * Account deletion forms (Google Play release preparation).
 *
 * The actions in lib/account/actions.ts take a bare FormData
 * (and the admin action takes ids), not the (prev, FormData)
 * shape the shared ActionForm drives — so, like
 * components/risk/resolve-event-form.tsx, these client
 * wrappers use useActionState directly and render the same
 * error / success / pending treatment ActionForm renders.
 * No deletion logic lives here: both forms post to the ONE
 * backend in lib/account (actions over service cores).
 *
 * DeletionRequestForm's success message is deliberately NOT
 * the action's own message: the page shows one uniform text
 * for every outcome (recorded, already pending, rate-limited,
 * honeypot) so the form can never be used as an oracle for
 * whether an email address is registered.
 */

export const DELETION_REQUEST_SUCCESS_MESSAGE =
  "Thank you. If an account exists for this email address, a deletion request has been recorded. Requests are verified and processed within 30 days. For immediate deletion, sign in and use the deletion option in your profile — or delete from the mobile app under Profile.";

function FormState({ state }: { state: ActionResult }) {
  return (
    <>
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
    </>
  );
}

function SubmitButton({
  pending,
  submitLabel,
  submitClassName,
}: {
  pending: boolean;
  submitLabel: string;
  submitClassName: string;
}) {
  return (
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
  );
}

/* --------------------------------------- public request form */

export function DeletionRequestForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = await requestDeletionAction(formData);
      // Uniform success text (see the header note): whatever
      // the action recorded, the visitor reads the same words.
      return result.ok
        ? { ok: true, message: DELETION_REQUEST_SUCCESS_MESSAGE }
        : result;
    },
    { ok: false },
  );
  return (
    <form action={formAction} encType="multipart/form-data" className="space-y-4">
      <FormState state={state} />
      <div className="itg2-field space-y-2">
        <Label htmlFor="deletion-email" className="itg2-label">
          Email address
        </Label>
        <Input
          id="deletion-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="itg2-input"
        />
      </div>
      {/* Honeypot: people never see this field. A submission
          with it filled is treated as a bot — the action
          answers with the same success state and writes
          nothing. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <SubmitButton
        pending={pending}
        submitLabel="Request account deletion"
        submitClassName="itg2-btn-primary itg2-btn-save"
      />
    </form>
  );
}

/* --------------------------------- signed-in danger-zone form */

export function DeleteOwnAccountForm({ children }: { children?: ReactNode }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => deleteOwnAccountAction(formData),
    { ok: false },
  );
  return (
    <form action={formAction} encType="multipart/form-data" className="space-y-4">
      <FormState state={state} />
      <div className="itg2-field space-y-2">
        <Label htmlFor="delete-password" className="itg2-label">
          Your password
        </Label>
        <Input
          id="delete-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="itg2-input"
        />
      </div>
      <div className="itg2-field space-y-2">
        <Label htmlFor="delete-confirm" className="itg2-label">
          Type DELETE to confirm
        </Label>
        <Input
          id="delete-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          required
          placeholder="DELETE"
          className="itg2-input"
        />
      </div>
      {children}
      <SubmitButton
        pending={pending}
        submitLabel="Delete my account permanently"
        submitClassName="itg2-btn-danger w-full"
      />
    </form>
  );
}
