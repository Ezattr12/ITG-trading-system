"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { writeAuditLog } from "@/lib/auth/audit";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
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
import {
  getGoalById,
  getLatestDisciplineEvent,
} from "./queries";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import type { DisciplineEventKind, NotificationType } from "./types";

/**
 * Goals, discipline & notification Server Actions (Phase 6, spec §21–23, §30).
 *
 * Same pattern as Phases 2/3/5: Zod first, Supabase second, RLS
 * enforces that a trader only touches their own rows. One goal row
 * per goal; progress is recorded per goal per day (upsert).
 *
 * `discipline_events` and `notifications` have no client INSERT
 * policy (migrations 0010/0012, append-only like `audit_logs`) —
 * rows are written server-side via the service-role client, by
 * `logDisciplineEvent` / `createNotification`. Both are
 * best-effort and never block a page or a save.
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

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/* ------------------------------------------------------- server-side writes */

/** Log a discipline reminder event. Returns true only when a row was inserted. */
export async function logDisciplineEvent(input: {
  userId: string;
  eventDate: string;
  kind: DisciplineEventKind;
  level: 1 | 2 | 3;
  message: string;
  details?: Record<string, unknown>;
}): Promise<boolean> {
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return false;
  const { error } = await admin.from("discipline_events").insert({
    user_id: input.userId,
    event_date: input.eventDate,
    kind: input.kind,
    level: input.level,
    message: input.message,
    details: input.details ?? {},
  });
  return !error;
}

/** Create one in-app notification. Returns true only when a row was inserted. */
export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}): Promise<boolean> {
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return false;
  const { error } = await admin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    related_entity_type: input.relatedEntityType ?? null,
    related_entity_id: input.relatedEntityId ?? null,
    is_read: false,
  });
  return !error;
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
  const v = parsed.data;
  const { error } = await supabase.from("goals").insert({
    user_id: userId,
    title: v.title,
    period: v.period,
    goal_type: v.goalType,
    target_value: v.targetValue,
    target_unit: v.targetUnit,
    start_date: v.startDate,
    end_date: v.endDate,
    status: "active",
  });
  if (error) return { ok: false, error: "Could not save your goal. Please try again." };
  await writeAuditLog({
    userId,
    action: "goal.created",
    entityType: "goals",
    details: { title: v.title, period: v.period, goalType: v.goalType },
  });
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
  const goal = await getGoalById(supabase, userId, parsed.data.goalId);
  if (!goal) return { ok: false, error: "That goal was not found." };
  const { error } = await supabase.from("goal_progress").upsert(
    {
      goal_id: goal.id,
      user_id: userId,
      current_value: parsed.data.currentValue,
      recorded_date: todayString(),
      note: parsed.data.note,
    },
    { onConflict: "goal_id,recorded_date" },
  );
  if (error) return { ok: false, error: "Could not record your progress. Please try again." };
  if (parsed.data.currentValue >= goal.target_value && goal.status === "active") {
    await createNotification({
      userId,
      type: "goal_reminder",
      title: `Goal reached: ${goal.title}`,
      body: `You reached ${parsed.data.currentValue} of your ${goal.target_value} target. Mark it complete when you're ready.`,
      relatedEntityType: "goal",
      relatedEntityId: goal.id,
    });
  }
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
  const goal = await getGoalById(supabase, userId, parsed.data.goalId);
  if (!goal) return { ok: false, error: "That goal was not found." };
  const { error } = await supabase
    .from("goals")
    .update({ status: parsed.data.status })
    .eq("id", goal.id);
  if (error) return { ok: false, error: "Could not update your goal. Please try again." };
  if (parsed.data.status === "completed") {
    await createNotification({
      userId,
      type: "goal_reminder",
      title: `Goal completed: ${goal.title}`,
      body: "Well done — you completed this goal. Your progress is saved on the Goals page.",
      relatedEntityType: "goal",
      relatedEntityId: goal.id,
    });
    // +20 XP for a completed goal (spec §24, Phase 7), idempotent
    // per goal, then achievements + stored level (best-effort).
    await awardXp({
      userId,
      reason: "daily_goal",
      sourceRefId: goal.id,
      note: `Goal completed: ${goal.title}`,
    });
    const gamification = await refreshGamification(supabase, userId);
    for (const achievement of gamification.unlocked) {
      await createNotification({
        userId,
        type: "achievement",
        title: `Achievement unlocked: ${achievement.name}`,
        body: achievement.description ?? `You earned ${achievement.xp_reward} XP.`,
        relatedEntityType: "achievement",
        relatedEntityId: achievement.id,
      });
    }
    if (
      gamification.currentLevel !== null &&
      gamification.previousLevel !== null &&
      gamification.currentLevel !== gamification.previousLevel
    ) {
      await createNotification({
        userId,
        type: "level_up",
        title: `Level up: ${gamification.currentLevel}`,
        body: `Your multi-dimensional score reached the ${gamification.currentLevel} level.`,
      });
    }
  }
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
