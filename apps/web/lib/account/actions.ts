"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createServerSupabaseClient,
  createServiceRoleSupabaseClient,
} from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import type { ActionResult } from "@/lib/auth/actions";
import { writeAuditLog } from "@/lib/auth/audit";
import {
  ADMIN_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  checkPresetRateLimit,
  checkRateLimit,
  rateLimitMessage,
} from "@/lib/auth/rate-limit";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  deleteAccountCore,
  requestAccountDeletion,
  verifyUserPassword,
} from "./service";

/**
 * Account deletion actions (Google Play release preparation).
 *
 * Three surfaces over the ONE core in lib/account/service.ts:
 *
 * - `deleteOwnAccountAction` — the signed-in trader deletes
 *   their OWN account. Identity comes from the session only
 *   (there is no user-id input to tamper with); the password
 *   is re-verified and the literal confirmation DELETE is
 *   required before anything destructive happens.
 * - `requestDeletionAction` — the public, signed-out
 *   deletion-request form. Its response is deliberately
 *   uniform: it never reveals whether an email is
 *   registered, already has a request pending, was
 *   rate-limited or was a bot submission (honeypot).
 * - `processDeletionRequestAction` — an admin works the
 *   request queue. Gated by requireAdmin() FIRST, before
 *   any read or write.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUEST_SUCCESS: ActionResult = {
  ok: true,
  message:
    "Thank you — if an account exists for that email address, a deletion request has been recorded. An administrator will process it; no further action is needed.",
};

/* ------------------------------------------------- own account */

export async function deleteOwnAccountAction(formData: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "DELETE") {
    return { ok: false, error: "Type DELETE (in capitals) to confirm account deletion." };
  }
  if (password === "") {
    return { ok: false, error: "Enter your password to delete your account." };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { ok: false, error: "You are not logged in. Please log in and try again." };
  }

  // Password re-verification is the destructive gate —
  // throttle it like a login attempt (per account).
  const rate = checkRateLimit(
    `account-delete:${user.email.toLowerCase()}`,
    AUTH_RATE_LIMIT.limit,
    AUTH_RATE_LIMIT.windowMs,
  );
  if (!rate.allowed) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
    };
  }
  const passwordOk = await verifyUserPassword(user.email, password);
  if (!passwordOk) {
    return { ok: false, error: "Password is incorrect." };
  }

  const admin = createServiceRoleSupabaseClient();
  if (!admin) {
    return { ok: false, error: "Account deletion is unavailable right now. Please try again later." };
  }
  try {
    await deleteAccountCore(admin, user.id);
  } catch {
    return { ok: false, error: "Could not delete your account. Please try again." };
  }

  // The account is gone; record the event on an unlinked
  // audit row (a row naming the user could no longer be
  // inserted — and the mobile pipeline's pre-delete row is
  // the linked-then-severed trail). Best-effort by design.
  await writeAuditLog({
    userId: null,
    action: "account.deleted",
    entityType: "account",
    entityId: null,
    details: { surface: "web" },
  });

  // The session's user no longer exists; clear the cookies
  // on the way out. signOut may itself fail against a
  // deleted user — that must not block the redirect.
  try {
    await supabase.auth.signOut();
  } catch {
    // Session is invalid either way; the redirect stands.
  }
  redirect("/login?account_deleted=1");
}

/* ------------------------------------------- public request form */

export async function requestDeletionAction(formData: FormData): Promise<ActionResult> {
  // Honeypot: real visitors never see or fill `website`.
  // A filled field means a bot — answer with the same
  // success state and write nothing.
  if (String(formData.get("website") ?? "").trim() !== "") {
    return REQUEST_SUCCESS;
  }
  const email = String(formData.get("email") ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for") ?? "";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown";
  const rate = checkRateLimit(`account-deletion-request:${ip}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) {
    // Throttled: same response, no write — the form never
    // confirms or denies anything about an email address.
    return REQUEST_SUCCESS;
  }

  try {
    await requestAccountDeletion(email);
  } catch {
    // Uniform response regardless of the write's outcome.
  }
  return REQUEST_SUCCESS;
}

/* ------------------------------------------------ admin processing */

export type DeletionDecision = "process" | "dismiss";

export async function processDeletionRequestAction(
  requestId: string,
  decision: DeletionDecision,
): Promise<ActionResult> {
  // Admin gate FIRST — before any read or write. Denial is
  // the indistinguishable 404 (requireAdmin calls notFound).
  const adminUser = await requireAdmin();

  if (!requestId) return { ok: false, error: "Choose a deletion request first." };
  if (decision !== "process" && decision !== "dismiss") {
    return { ok: false, error: "Invalid decision." };
  }
  const limited = checkPresetRateLimit(
    `admin:${adminUser.id}:processDeletionRequestAction`,
    ADMIN_RATE_LIMIT,
  );
  if (!limited.allowed) {
    return { ok: false, error: rateLimitMessage("admin actions", limited) };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const admin = createServiceRoleSupabaseClient();
  if (!admin) {
    return { ok: false, error: "Supabase is not configured — nothing was changed." };
  }

  const { data: requestRow } = await admin
    .from("account_deletion_requests")
    .select("id, email, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!requestRow) return { ok: false, error: "Deletion request not found." };
  if (requestRow.status !== "pending") {
    return { ok: false, error: "This request has already been handled." };
  }

  const stamp = {
    processed_at: new Date().toISOString(),
    processed_by: adminUser.id,
  };

  if (decision === "dismiss") {
    const { error } = await admin
      .from("account_deletion_requests")
      .update({ ...stamp, status: "dismissed" })
      .eq("id", requestId);
    if (error) return { ok: false, error: "Could not dismiss the request. Please try again." };
    return { ok: true, message: "Request dismissed." };
  }

  // 'process': find the account by email (admin list is
  // paginated; emails are matched case-insensitively).
  const target = String(requestRow.email).toLowerCase();
  let matchedUserId: string | null = null;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data) break;
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) {
      matchedUserId = match.id;
      break;
    }
    if (data.users.length < 100) break;
  }

  // The request row itself is the processing trail:
  // processed_by / processed_at / note record who acted,
  // when, and what was found — including the honest
  // "no matching account" outcome, which still closes the
  // request (there is nothing to delete).
  let note = "no matching account";
  if (matchedUserId) {
    let summary;
    try {
      summary = await deleteAccountCore(admin, matchedUserId);
    } catch {
      // Leave the request pending so it can be retried.
      return { ok: false, error: "Could not delete the account. The request is still pending." };
    }
    note = `account deleted (storage removed: ${summary.screenshotsRemoved} screenshots, ${summary.avatarsRemoved} avatars${summary.storageError ? "; storage cleanup reported errors" : ""})`;
  }
  const { error } = await admin
    .from("account_deletion_requests")
    .update({ ...stamp, status: "processed", note })
    .eq("id", requestId);
  if (error) return { ok: false, error: "Could not mark the request processed. Please try again." };
  return { ok: true, message: matchedUserId ? "Account deleted and request processed." : "Request processed — no matching account." };
}
