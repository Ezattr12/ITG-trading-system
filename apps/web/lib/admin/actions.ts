"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { adminGate, roleChangeError } from "./access";
import { ADMIN_AUDIT_ACTIONS, writeAdminAuditLog } from "./audit";
import { getAdminUserFinancials, getRecentAuditForUser } from "./queries";
import { ADMIN_RATE_LIMIT, checkPresetRateLimit, rateLimitMessage } from "@/lib/auth/rate-limit";
import { toAdminUserFinancials, hasRecentFinancialAccess } from "./access";
import {
  achievementConfigSchema,
  financialViewSchema,
  firstZodError,
  levelThresholdSchema,
  revokeCertificateSchema,
  roleChangeSchema,
  systemSettingSchema,
  verificationChangeSchema,
} from "./validation";

/**
 * Admin Server Actions (Phase 10, spec §10, §40–42).
 *
 * Every action: Supabase configured → signed-in admin (role
 * 'admin' on their profile; the 'auditor' role exists in the enum
 * but has no admin access today — see lib/admin/access.ts) → Zod
 * → rate limit (Phase 11) → service-role write (RLS deliberately blocks
 * client writes to profiles/certificates/audit_logs) → audit-log
 * row with admin id, target, action and reason → revalidate.
 * A failed audit write is reported as a failure: an admin change
 * with no audit trail must not be presented as done.
 */

async function requireAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; error: string }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const user = await getCurrentUser();
  const gate = adminGate(user?.profile ?? null);
  if (!gate.allowed) return { ok: false, error: gate.reason };
  if (!user) return { ok: false, error: "Please log in first." };
  return { ok: true, user };
}

/**
 * Rate-limit admin writes (Phase 11): 20 per minute per admin,
 * per action. A flood of role changes, revokes or setting writes
 * is stopped before any database write happens.
 */
function checkAdminRateLimit(
  adminId: string,
  action: string,
): { ok: true } | { ok: false; error: string } {
  const result = checkPresetRateLimit(`admin:${adminId}:${action}`, ADMIN_RATE_LIMIT);
  if (!result.allowed) return { ok: false, error: rateLimitMessage("admin actions", result) };
  return { ok: true };
}

function serviceClient(): ReturnType<typeof createServiceRoleSupabaseClient> {
  return createServiceRoleSupabaseClient();
}

export async function changeUserRoleAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const limited = checkAdminRateLimit(admin.user.id, "changeUserRoleAction");
  if (!limited.ok) return limited;
  const parsed = roleChangeSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const selfError = roleChangeError(admin.user.id, parsed.data.userId, parsed.data.role);
  if (selfError) return { ok: false, error: selfError };

  const client = serviceClient();
  if (!client) return { ok: false, error: "Supabase is not configured — the role was not changed." };
  const { data: before } = await client
    .from("profiles")
    .select("role")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  if (!before) return { ok: false, error: "User not found." };
  const { error } = await client
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.userId);
  if (error) return { ok: false, error: "Could not change the role. Please try again." };
  const audited = await writeAdminAuditLog(client, {
    actorId: admin.user.id,
    targetUserId: parsed.data.userId,
    action: ADMIN_AUDIT_ACTIONS.roleChange,
    entityType: "profile",
    entityId: parsed.data.userId,
    reason: String(formData.get("reason") ?? "Role changed by admin."),
    details: { from: (before as { role: string }).role, to: parsed.data.role },
  });
  if (!audited) return { ok: false, error: "Role changed but the audit log could not be written. Please check the audit page." };
  revalidatePath("/admin/users");
  return { ok: true, message: `Role changed to ${parsed.data.role}.` };
}

export async function changeVerificationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const limited = checkAdminRateLimit(admin.user.id, "changeVerificationAction");
  if (!limited.ok) return limited;
  const parsed = verificationChangeSchema.safeParse({
    userId: formData.get("userId"),
    verificationStatus: formData.get("verificationStatus"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const client = serviceClient();
  if (!client) return { ok: false, error: "Supabase is not configured — the verification status was not changed." };
  const { data: before } = await client
    .from("profiles")
    .select("verification_status")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  if (!before) return { ok: false, error: "User not found." };
  const { error } = await client
    .from("profiles")
    .update({ verification_status: parsed.data.verificationStatus })
    .eq("id", parsed.data.userId);
  if (error) return { ok: false, error: "Could not change the verification status. Please try again." };
  const audited = await writeAdminAuditLog(client, {
    actorId: admin.user.id,
    targetUserId: parsed.data.userId,
    action: ADMIN_AUDIT_ACTIONS.verificationChange,
    entityType: "profile",
    entityId: parsed.data.userId,
    reason: String(formData.get("reason") ?? "Verification status changed by admin."),
    details: {
      from: (before as { verification_status: string }).verification_status,
      to: parsed.data.verificationStatus,
    },
  });
  if (!audited) return { ok: false, error: "Verification changed but the audit log could not be written. Please check the audit page." };
  revalidatePath("/admin/users");
  return { ok: true, message: `Verification status changed to ${parsed.data.verificationStatus}.` };
}

export async function revokeCertificateAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const limited = checkAdminRateLimit(admin.user.id, "revokeCertificateAction");
  if (!limited.ok) return limited;
  const parsed = revokeCertificateSchema.safeParse({
    certificateId: formData.get("certificateId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const client = serviceClient();
  if (!client) return { ok: false, error: "Supabase is not configured — the certificate was not revoked." };
  const { data: cert } = await client
    .from("certificates")
    .select("id, user_id, certificate_id, status")
    .eq("id", parsed.data.certificateId)
    .maybeSingle();
  if (!cert) return { ok: false, error: "Certificate not found." };
  if ((cert as { status: string }).status !== "issued") {
    return { ok: false, error: "Only an issued certificate can be revoked." };
  }
  const { error } = await client
    .from("certificates")
    .update({ status: "revoked" })
    .eq("id", parsed.data.certificateId);
  if (error) return { ok: false, error: "Could not revoke the certificate. Please try again." };
  const audited = await writeAdminAuditLog(client, {
    actorId: admin.user.id,
    targetUserId: (cert as { user_id: string }).user_id,
    action: ADMIN_AUDIT_ACTIONS.certificateRevoke,
    entityType: "certificate",
    entityId: parsed.data.certificateId,
    reason: parsed.data.reason,
    details: { certificate_id: (cert as { certificate_id: string }).certificate_id },
  });
  if (!audited) return { ok: false, error: "Certificate revoked but the audit log could not be written. Please check the audit page." };
  revalidatePath("/admin/certificates");
  return { ok: true, message: "Certificate revoked." };
}

export async function saveAchievementAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const limited = checkAdminRateLimit(admin.user.id, "saveAchievementAction");
  if (!limited.ok) return limited;
  const parsed = achievementConfigSchema.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") ?? "",
    category: formData.get("category"),
    xpReward: formData.get("xpReward"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const client = serviceClient();
  if (!client) return { ok: false, error: "Supabase is not configured — the achievement was not saved." };
  const row = {
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description || null,
    category: parsed.data.category,
    xp_reward: parsed.data.xpReward,
  };
  let entityId = parsed.data.id || null;
  if (entityId) {
    const { error } = await client.from("achievements").update(row).eq("id", entityId);
    if (error) return { ok: false, error: "Could not update the achievement. Please try again." };
  } else {
    const { data, error } = await client.from("achievements").insert(row).select("id").single();
    if (error || !data) return { ok: false, error: "Could not create the achievement. Please try again." };
    entityId = (data as { id: string }).id;
  }
  const audited = await writeAdminAuditLog(client, {
    actorId: admin.user.id,
    action: ADMIN_AUDIT_ACTIONS.achievementChange,
    entityType: "achievement",
    entityId,
    reason: parsed.data.id ? "Achievement config updated by admin." : "Achievement created by admin.",
    details: { slug: parsed.data.slug, xp_reward: parsed.data.xpReward },
  });
  if (!audited) return { ok: false, error: "Achievement saved but the audit log could not be written. Please check the audit page." };
  revalidatePath("/admin/achievements");
  return { ok: true, message: "Achievement saved." };
}

export async function saveLevelThresholdAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const limited = checkAdminRateLimit(admin.user.id, "saveLevelThresholdAction");
  if (!limited.ok) return limited;
  const parsed = levelThresholdSchema.safeParse({
    levelId: formData.get("levelId"),
    minScore: formData.get("minScore"),
    maxScore: formData.get("maxScore") ?? "",
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const client = serviceClient();
  if (!client) return { ok: false, error: "Supabase is not configured — the level was not changed." };
  const { data: before } = await client
    .from("levels")
    .select("name, min_score, max_score")
    .eq("id", parsed.data.levelId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Level not found." };
  const { error } = await client
    .from("levels")
    .update({ min_score: parsed.data.minScore, max_score: parsed.data.maxScore })
    .eq("id", parsed.data.levelId);
  if (error) return { ok: false, error: "Could not update the level. Please try again." };
  const audited = await writeAdminAuditLog(client, {
    actorId: admin.user.id,
    action: ADMIN_AUDIT_ACTIONS.levelChange,
    entityType: "level",
    entityId: parsed.data.levelId,
    reason: "Level thresholds changed by admin.",
    details: {
      name: (before as { name: string }).name,
      from: { min: (before as { min_score: number }).min_score, max: (before as { max_score: number | null }).max_score },
      to: { min: parsed.data.minScore, max: parsed.data.maxScore },
    },
  });
  if (!audited) return { ok: false, error: "Level changed but the audit log could not be written. Please check the audit page." };
  revalidatePath("/admin/levels");
  return { ok: true, message: "Level thresholds updated." };
}

export async function saveSystemSettingAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const limited = checkAdminRateLimit(admin.user.id, "saveSystemSettingAction");
  if (!limited.ok) return limited;
  const parsed = systemSettingSchema.safeParse({
    key: formData.get("key"),
    value: formData.get("value"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const client = serviceClient();
  if (!client) return { ok: false, error: "Supabase is not configured — the setting was not saved." };
  const value = JSON.parse(parsed.data.value) as unknown;
  const { error } = await client
    .from("system_settings")
    .upsert({ key: parsed.data.key, value, updated_by: admin.user.id });
  if (error) return { ok: false, error: "Could not save the setting. Please try again." };
  const audited = await writeAdminAuditLog(client, {
    actorId: admin.user.id,
    action: ADMIN_AUDIT_ACTIONS.settingChange,
    entityType: "system_setting",
    entityId: null,
    reason: "System setting changed by admin.",
    details: { key: parsed.data.key, value },
  });
  if (!audited) return { ok: false, error: "Setting saved but the audit log could not be written. Please check the audit page." };
  revalidatePath("/admin/settings");
  return { ok: true, message: `Setting ${parsed.data.key} saved.` };
}

/**
 * Financial view: the admin states a reason, the action writes the
 * audit row FIRST, and only then may the detail page show the
 * trader's financial fields — for 15 minutes, checked against the
 * audit log (see hasRecentFinancialAccess). The action itself
 * returns no financial data.
 */
export async function requestFinancialViewAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const limited = checkAdminRateLimit(admin.user.id, "requestFinancialViewAction");
  if (!limited.ok) return limited;
  const parsed = financialViewSchema.safeParse({
    userId: formData.get("userId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const client = serviceClient();
  if (!client) return { ok: false, error: "Supabase is not configured — the financial view was not authorised." };
  const audited = await writeAdminAuditLog(client, {
    actorId: admin.user.id,
    targetUserId: parsed.data.userId,
    action: ADMIN_AUDIT_ACTIONS.financialView,
    entityType: "profile",
    entityId: parsed.data.userId,
    reason: parsed.data.reason,
  });
  if (!audited) return { ok: false, error: "The financial view could not be audit-logged, so it was not authorised." };
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return {
    ok: true,
    message: "Financial view authorised for 15 minutes and audit-logged. The financial fields are now shown on this page.",
    redirectTo: `/admin/users/${parsed.data.userId}`,
  };
}

/** Helper for the user-detail page: financials only when a recent audit row exists. */
export async function getAuthorisedFinancials(userId: string, adminId: string) {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createServerSupabaseClient();
  const rows = await getRecentAuditForUser(supabase, adminId, userId);
  if (!hasRecentFinancialAccess(rows, adminId, userId)) return null;
  const row = await getAdminUserFinancials(supabase, userId);
  if (!row) return null;
  return toAdminUserFinancials(userId, row);
}
