"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import {
  buildDisciplineReminder,
  currentRunLoggedLevel,
  escalationNeeded,
} from "./engine";
import {
  firstZodError,
  goalProgressSchema,
  goalSchema,
  goalStatusSchema,
} from "./validation";
import { getLatestDisciplineEvent } from "./queries";
import {
  createGoalCore,
  createNotification as createNotificationCore,
  logDisciplineEvent as logDisciplineEventCore,
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
 * lib/discipline/service.ts and re-exported below so existing
 * import sites are unchanged). Both are best-effort and never
 * block a page or a save.
 */

/**
 * The discipline/notification write engines live in
 * lib/discipline/service.ts (Phase 21). They are re-exported
 * here — as delegating async functions, since a "use server"
 * module may only export async functions — so every
 * existing import site (`@/lib/discipline/actions`) keeps
 * working unchanged.
 */
export async function logDisciplineEvent(
  input: Parameters<typeof logDisciplineEventCore>[0],
): ReturnType<typeof logDisciplineEventCore> {
  return logDisciplineEventCore(input);
}

export async function createNotification(
  input: Parameters<typeof createNotificationCore>[0],
): ReturnType<typeof createNotificationCore> {
  return createNotificationCore(input);
}

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

/**
 * Log the current discipline reminder when it escalated past the
 * highest level already logged for this missed run, and mirror it
 * as an in-app notification. Idempotent: the same level is never
 * logged twice (unique key + escalation check), so calling this
 * on a page render is safe. Returns the reminder (level 0 = none).
 *
 * Called from the dashboard render, where the reminder is shown —
 * there is no daily cron yet (Phase 13), so the render is the
 * moment the trader can actually see the reminder.
 */
export async function ensureDisciplineReminderLogged(
  userId: string,
  lastJournalDate: string | null,
  today: string,
): Promise<{ level: 0 | 1 | 2 | 3; title: string; body: string; missedDays: number }> {
  const reminder = buildDisciplineReminder(lastJournalDate, today);
  if (reminder.level === 0) return reminder;
  if (!isSupabaseConfigured()) return reminder;
  const supabase = await createServerSupabaseClient();
  const latest = await getLatestDisciplineEvent(supabase, userId, "missed_journal");
  const loggedLevel = currentRunLoggedLevel(latest, lastJournalDate);
  if (!escalationNeeded(loggedLevel, reminder.level)) return reminder;
  const logged = await logDisciplineEvent({
    userId,
    eventDate: today,
    kind: "missed_journal",
    level: reminder.level,
    message: reminder.body,
    details: { missedDays: reminder.missedDays, lastJournalDate },
  });
  if (logged) {
    await createNotification({
      userId,
      type: reminder.level === 1 ? "journal_reminder" : "discipline_warning",
      title: reminder.title,
      body: reminder.body,
    });
  }
  return reminder;
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
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "Could not mark the notification as read. Please try again." };
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
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) return { ok: false, error: "Could not mark notifications as read. Please try again." };
  revalidatePath("/notifications");
  return { ok: true, message: "All notifications marked as read." };
}
