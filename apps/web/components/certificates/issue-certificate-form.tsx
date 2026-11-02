"use client";

import { useActionState } from "react";
import { issueCertificateAction } from "@/lib/certificates/actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Issue-certificate button (Phase 8).
 *
 * Shown only when every criterion is met for the month. The
 * Server Action re-checks eligibility from the stored data, so
 * a certificate can never be issued from a stale page state.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * the submit is a native button on .itg2-btn-primary (the
 * class carries its full box/type/paint in the unlayered
 * tail of itg2.css, like the other v2 form submits) and the
 * result lines use the semantic .itg2-text-loss /
 * .itg2-text-profit tones. Labels, the pending state, the
 * form action and the messages are exactly as before.
 */
export function IssueCertificateForm({ month }: { month: string }) {
  const [state, formAction, pending] = useActionState<
    ActionResult & { certificateId?: string },
    FormData
  >(issueCertificateAction, { ok: false });
  return (
    <form action={formAction}>
      <input type="hidden" name="month" value={month} />
      <button type="submit" disabled={pending} className="itg2-btn-primary">
        {pending ? "Issuing…" : "Issue my certificate"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm itg2-text-loss">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="mt-2 text-sm itg2-text-profit">
          {state.message}
        </p>
      )}
    </form>
  );
}
