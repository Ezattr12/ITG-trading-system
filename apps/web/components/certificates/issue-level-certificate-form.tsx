"use client";

import { useActionState } from "react";
import { issueLevelCertificateAction } from "@/lib/certificates/level-actions";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * Issue-level-certificate button (Task 24).
 *
 * Shown for a PASSED level assessment that has no certificate
 * yet. The form carries only the assessment id — the Server
 * Action re-reads the pass from the stored record and snapshots
 * the band, date and score onto the certificate, so nothing on
 * the certificate can come from the client. Issuance is
 * idempotent: re-submitting returns the existing certificate.
 *
 * Presentation follows the monthly issue form: a native button
 * on .itg2-btn-primary, result lines in the semantic tones.
 */
export function IssueLevelCertificateForm({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult & { certificateId?: string },
    FormData
  >(issueLevelCertificateAction, { ok: false });
  return (
    <form action={formAction}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <button type="submit" disabled={pending} className="itg2-btn-primary">
        {pending ? "Issuing…" : "Issue level certificate"}
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
