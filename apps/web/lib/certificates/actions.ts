"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/auth/session";
import { createNotification } from "@/lib/discipline/actions";
import {
  eligibilityToCriteriaMet,
  evaluateMonthlyEligibility,
  generateCertificateId,
  monthStart,
} from "./eligibility";
import { getMonthlyCertificateInputs } from "./queries";

/**
 * Certificate Server Actions (Phase 8, spec §26).
 *
 * `certificates` has no client INSERT policy (migration 0009:
 * issued server-side), so issuance goes through the service-role
 * client — the same pattern as XP and risk/discipline events.
 * Issuance is idempotent per (user, month): the table has a
 * unique (user_id, month) constraint, so a second issue attempt
 * for the same month returns the existing certificate instead of
 * a duplicate. A certificate is written ONLY when every
 * criterion is met; otherwise the action returns the missing
 * criteria as the error, so the UI can show them honestly.
 */
export async function issueCertificateAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult & { certificateId?: string }> {
  const month = String(formData.get("month") ?? "");
  const start = monthStart(month);
  if (!start) return { ok: false, error: "Choose a valid month (YYYY-MM)." };
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in first." };

  const supabase = await createServerSupabaseClient();
  const inputs = await getMonthlyCertificateInputs(supabase, user.id, start);
  const eligibility = evaluateMonthlyEligibility(inputs);
  if (!eligibility.eligible) {
    const missing = eligibility.criteria
      .filter((c) => !c.met)
      .map((c) => c.label)
      .join(", ");
    return {
      ok: false,
      error: `Certificate requirements are not met yet for this month. Missing: ${missing}.`,
    };
  }

  const admin = createServiceRoleSupabaseClient();
  if (!admin) {
    return { ok: false, error: "Supabase is not configured — the certificate was not issued." };
  }

  // Already issued for this month? Return the existing one.
  const { data: existing } = await admin
    .from("certificates")
    .select("certificate_id")
    .eq("user_id", user.id)
    .eq("month", start)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      message: "Certificate already issued for this month.",
      certificateId: (existing as { certificate_id: string }).certificate_id,
    };
  }

  // Unique certificate_id, retried on the (rare) collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const certificateId = generateCertificateId(start);
    const { error } = await admin.from("certificates").insert({
      user_id: user.id,
      certificate_id: certificateId,
      month: start,
      criteria_met: eligibilityToCriteriaMet(eligibility, inputs),
      status: "issued",
      issued_at: new Date().toISOString(),
    });
    if (!error) {
      await createNotification({
        userId: user.id,
        type: "achievement",
        title: "Monthly certificate issued",
        body: `Your ITG Performance Certificate for ${start.slice(0, 7)} is ready to download.`,
        relatedEntityType: "certificate",
        relatedEntityId: certificateId,
      });
      revalidatePath("/certificates");
      return {
        ok: true,
        message: "Certificate issued.",
        certificateId,
      };
    }
    // A duplicate certificate_id (not month) is the only retryable
    // failure here; anything else is a real error.
    if (!String(error.message ?? "").includes("duplicate")) {
      return { ok: false, error: "Could not issue the certificate. Please try again." };
    }
  }
  return { ok: false, error: "Could not issue the certificate. Please try again." };
}
