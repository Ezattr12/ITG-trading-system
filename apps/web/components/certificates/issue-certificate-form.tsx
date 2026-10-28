"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { issueCertificateAction } from "@/lib/certificates/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Issue-certificate button (Phase 8).
 *
 * Shown only when every criterion is met for the month. The
 * Server Action re-checks eligibility from the stored data, so
 * a certificate can never be issued from a stale page state.
 */
export function IssueCertificateForm({ month }: { month: string }) {
  const [state, formAction, pending] = useActionState<
    ActionResult & { certificateId?: string },
    FormData
  >(issueCertificateAction, { ok: false });
  return (
    <form action={formAction}>
      <input type="hidden" name="month" value={month} />
      <Button type="submit" disabled={pending}>
        {pending ? "Issuing…" : "Issue my certificate"}
      </Button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="mt-2 text-sm text-emerald-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
