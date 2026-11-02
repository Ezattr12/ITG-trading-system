"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import {
  firstZodError,
  goalProgressSchema,
  goalSchema,
  goalStatusSchema,
} from "./validation";
import {
  createGoalCore,
  markAllNotificationsReadCore,
  markNotificationReadCore,
  recordGoalProgressCore,
  updateGoalStatusCore,
} from "./service";

/**
 * Goals, discipline & notification Server Actions (Phase 6, spec §21–23, §30).
 *
 * Phase 21 (M1): the goal write logic lives in
 * lib/discipline/service.ts as cores shared with the mobile
 * API — these actions are now thin adapters (session auth +
 * FormData → core → revalidate/message), with identical
 * behaviour and messages. The notification mark-read actions
 * were not extracted in M1 (see docs/phase-21-m1.md) and are
 * unchanged.
 *
 * `discipline_events` and `notifications` have no client INSERT
 * policy (migrations 0010/0012, append-only like `audit_logs`) —
 * rows are written server-side via the service-role client, by
 * `logDisciplineEvent` / `createNotification` (defined in
 * lib/discipline/service.ts). Both are best-effort and never
 * block a page or a save.
 *
 * Task 13 (finding F3): the delegating re-export wrappers for
 * those two engines, and `ensureDisciplineReminderLogged`, were
 * removed from this "use server" module — as exports here they
 * were invocable as Server Actions with a caller-supplied
 * userId. All three now live only in lib/discipline/service.ts
 * and every caller imports them from there.
 */

function notConfigured(): ActionResult {
  return { ok: false, error: supabaseNotConnectedMessage() };
}

function toNumberOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/* -------------------------------------------------------------------- goals */

export async function createGoalAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = goalSchema.safeParse({
    title: toText(formData.get("title")) ?? "",
    period: toText(formData.get("period")) ?? "",
    goalType: toText(formData.get("goalType")) ?? "",
    targetValue: toNumberOrNull(formData.get("targetValue")),
    targetUnit: toText(formData.get("targetUnit")),
    startDate: toText(formData.get("startDate")) ?? "",
    endDate: toText(formData.get("endDate")),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  const result = await createGoalCore(supabase, userId, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return { ok: true, message: "Goal created." };
}

export async function recordGoalProgressAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = goalProgressSchema.safeParse({
    goalId: toText(formData.get("goalId")) ?? "",
    currentValue: toNumberOrNull(formData.get("currentValue")),
    note: toText(formData.get("note")),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  const result = await recordGoalProgressCore(supabase, userId, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return { ok: true, message: "Progress recorded." };
}

export async function updateGoalStatusAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = goalStatusSchema.safeParse({
    goalId: toText(formData.get("goalId")) ?? "",
    status: toText(formData.get("status")) ?? "",
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  const result = await updateGoalStatusCore(supabase, userId, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return { ok: true, message: `Goal marked as ${parsed.data.status}.` };
}

/* ------------------------------------------------------------ notifications */

export async function markNotificationReadAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const id = toText(formData.get("notificationId"));
  if (!id) return { ok: false, error: "Choose a notification first." };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  // The core scopes the row to the owner. A notification
  // that is not the caller's updates zero rows — exactly
  // what this action did before the extraction, and it
  // reported success (an update of zero rows is not an
  // error), so only a real save failure surfaces here.
  const result = await markNotificationReadCore(supabase, userId, id);
  if (!result.ok && result.code === "save_failed") {
    return { ok: false, error: result.error };
  }
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsReadAction(
  _prev: ActionResult,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  const result = await markAllNotificationsReadCore(supabase, userId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/notifications");
  return { ok: true, message: "All notifications marked as read." };
}
