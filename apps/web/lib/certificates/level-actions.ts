"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/auth/audit";
import { createNotification } from "@/lib/discipline/service";
import { generateCertificateId } from "./eligibility";

/**
 * Level certificate issuance (Task 24).
 *
 * A level certificate certifies ONE passed level assessment
 * (Task 23): the durable, append-only judgement that the
 * trader met a band's standard. It asserts the historical
 * fact — WAS assessed at the band on the assessment date —
 * never a claim about current standing.
 *
 * Trust rules, mirroring the monthly action:
 * - The client supplies only the assessment id. The band,
 *   score and date are read back from the stored assessment
 *   row (service role, filtered to the signed-in user AND
 *   verdict = 'pass'), so nothing about the certificate can
 *   be forged from form fields.
 * - The snapshot is copied onto the certificate row, so the
 *   certificate and its public verification never depend on
 *   mutable state (band names are admin-editable).
 * - Idempotent per (user, assessment): an existing
 *   certificate is returned as-is — no duplicate row, no
 *   second audit entry, no second notification. Migration
 *   0022's partial unique index enforces the same rule in the
 *   database.
 * - Issuance is a credential event: it writes the same
 *   `certificate.issued` audit action as the monthly flow
 *   (with kind/level details) and an achievement notification.
 *   A refused attempt writes nothing.
 */
export async function issueLevelCertificateAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult & { certificateId?: string }> {
  const assessmentId = String(formData.get("assessmentId") ?? "").trim();
  if (!assessmentId) {
    return { ok: false, error: "Choose a passed assessment to certify." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in first." };

  const admin = createServiceRoleSupabaseClient();
  if (!admin) {
    return { ok: false, error: "Supabase is not configured — the certificate was not issued." };
  }

  // The evidence, re-read from the stored record: it must be
  // THIS trader's assessment and it must be a pass. One error
  // for every failure — the response never reveals whether the
  // id exists on someone else's record.
  const { data: assessment } = await admin
    .from("level_assessments")
    .select("id, level_slug, level_name, score, verdict, created_at")
    .eq("id", assessmentId)
    .eq("user_id", user.id)
    .maybeSingle();
  const pass = assessment as {
    id: string;
    level_slug: string;
    level_name: string;
    score: number | string;
    verdict: string;
    created_at: string;
  } | null;
  if (!pass || pass.verdict !== "pass") {
    return {
      ok: false,
      error:
        "That assessment is not a passed assessment on your record, so no certificate can be issued for it.",
    };
  }

  // Already certified? Return the existing certificate.
  const { data: existing } = await admin
    .from("certificates")
    .select("certificate_id")
    .eq("user_id", user.id)
    .eq("assessment_id", pass.id)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      message: "Certificate already issued for this assessment.",
      certificateId: (existing as { certificate_id: string }).certificate_id,
    };
  }

  const score = Number(pass.score);
  const assessedDate = pass.created_at.slice(0, 10);
  const issuedAt = new Date().toISOString();

  // Unique certificate_id, retried on the (rare) collision —
  // the monthly action's pattern. The id carries the issuance
  // month, like a monthly certificate carries its month.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const certificateId = generateCertificateId(issuedAt.slice(0, 10));
    const { data: inserted, error } = await admin
      .from("certificates")
      .insert({
        user_id: user.id,
        certificate_id: certificateId,
        kind: "level",
        month: null,
        criteria_met: {
          kind: "level",
          assessment_id: pass.id,
          level_slug: pass.level_slug,
          level_name: pass.level_name,
          score,
          assessed_at: pass.created_at,
        },
        assessment_id: pass.id,
        level_slug: pass.level_slug,
        level_name: pass.level_name,
        assessed_at: pass.created_at,
        assessment_score: score,
        status: "issued",
        issued_at: issuedAt,
      })
      .select("id")
      .single();
    if (!error) {
      // audit_logs.entity_id and notifications.related_entity_id
      // are uuid columns, so they take the certificate ROW id —
      // passing the human certificate_id ("ITG-…") made Postgres
      // reject both writes, silently (both helpers are
      // best-effort). The human id stays traceable in the audit
      // details. (The monthly action had the identical defect;
      // see docs/task-24-certificates.md.)
      const rowId = (inserted as { id: string } | null)?.id ?? null;
      await writeAuditLog({
        userId: user.id,
        action: "certificate.issued",
        entityType: "certificates",
        entityId: rowId,
        details: {
          kind: "level",
          level_slug: pass.level_slug,
          assessment_id: pass.id,
          certificate_id: certificateId,
        },
      });
      await createNotification({
        userId: user.id,
        type: "achievement",
        title: "Level certificate issued",
        body: `Your ITG Level Certificate for the ${pass.level_name} band — assessed ${assessedDate} — is ready to download.`,
        relatedEntityType: "certificate",
        relatedEntityId: rowId,
      });
      revalidatePath("/certificates");
      return { ok: true, message: "Certificate issued.", certificateId };
    }
    // A duplicate on the (user, assessment) index means a
    // concurrent issue won the race — return that certificate
    // rather than erroring. A duplicate certificate_id is
    // retried with a fresh id; anything else is a real error.
    if (String(error.message ?? "").includes("duplicate")) {
      const { data: raced } = await admin
        .from("certificates")
        .select("certificate_id")
        .eq("user_id", user.id)
        .eq("assessment_id", pass.id)
        .maybeSingle();
      if (raced) {
        return {
          ok: true,
          message: "Certificate already issued for this assessment.",
          certificateId: (raced as { certificate_id: string }).certificate_id,
        };
      }
      continue;
    }
    return { ok: false, error: "Could not issue the certificate. Please try again." };
  }
  return { ok: false, error: "Could not issue the certificate. Please try again." };
}
