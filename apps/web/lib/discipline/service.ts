import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import type { CoreFailure } from "@/lib/trades/service";
import {
  firstZodError,
  goalProgressSchema,
  goalSchema,
  goalStatusSchema,
} from "./validation";
import { getGoalById } from "./queries";
import type { DisciplineEventKind, NotificationType } from "./types";

/**
 * Discipline / goals service (Phase 21, M1).
 *
 * Two kinds of exports live here:
 *
 * 1. The server-side write engines `logDisciplineEvent` /
 *    `createNotification` (moved verbatim from
 *    lib/discipline/actions.ts; that module re-exports them
 *    so every existing import site is unchanged).
 *    `discipline_events` and `notifications` have no client
 *    INSERT policy (migrations 0010/0012, append-only like
 *    `audit_logs`) — rows are written server-side via the
 *    service-role client. Both are best-effort and never
 *    block a page or a save.
 *
 * 2. The goal cores — the single source of truth for the
 *    goal write operations, extracted verbatim from the
 *    Server Actions in lib/discipline/actions.ts. The web
 *    actions are now adapters (session + FormData); the
 *    mobile API handlers call the same cores with the
 *    token-derived user id. Validation, messages, XP,
 *    notifications and audit behaviour are unchanged.
 *
 * CoreFailure codes are shared with lib/trades/service.ts.
 */

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

/* ------------------------------------------------- notification read marks */

export type MarkNotificationReadCoreResult =
  | { ok: true; updated: number }
  | CoreFailure;

/**
 * Mark one notification read (Phase 21, M2 extraction of
 * markNotificationReadAction). The notification must belong
 * to the caller — enforced by RLS and by the explicit
 * user_id scoping — or the result is not_found (the API
 * maps that to the same 404 a nonexistent id gets; the web
 * adapter keeps its historic message behaviour).
 */
export async function markNotificationReadCore(
  supabase: SupabaseClient,
  userId: string,
  notificationId: string,
): Promise<MarkNotificationReadCoreResult> {
  if (!notificationId) return fail("invalid_input", "Choose a notification first.");
  const { data: owned } = await supabase
    .from("notifications")
    .select("id")
    .eq("id", notificationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!owned) return fail("not_found", "Notification not found.");
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);
  if (error) {
    return fail("save_failed", "Could not mark the notification as read. Please try again.");
  }
  return { ok: true, updated: 1 };
}

/**
 * Mark every notification of the caller read (Phase 21, M2
 * extraction of markAllNotificationsReadAction). Returns
 * the number of previously-unread rows actually flipped,
 * counted before the update under the same scoping.
 */
export async function markAllNotificationsReadCore(
  supabase: SupabaseClient,
  userId: string,
): Promise<MarkNotificationReadCoreResult> {
  const { data: unread } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("is_read", false);
  const count = (unread ?? []).length;
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) return fail("save_failed", "Could not mark notifications as read. Please try again.");
  return { ok: true, updated: count };
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function fail(code: CoreFailure["code"], error: string): CoreFailure {
  return { ok: false, code, error };
}

/* -------------------------------------------------------------------- goals */

export interface CreatedGoal {
  id: string;
  title: string;
  period: string;
  goal_type: string;
  target_value: number;
  target_unit: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
}

export type CreateGoalCoreResult =
  | { ok: true; goal: CreatedGoal }
  | CoreFailure;

export async function createGoalCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<CreateGoalCoreResult> {
  const parsed = goalSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const v = parsed.data;
  const { data, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      title: v.title,
      period: v.period,
      goal_type: v.goalType,
      target_value: v.targetValue,
      target_unit: v.targetUnit,
      start_date: v.startDate,
      end_date: v.endDate,
      status: "active",
    })
    .select("id, title, period, goal_type, target_value, target_unit, start_date, end_date, status")
    .single();
  if (error || !data) return fail("save_failed", "Could not save your goal. Please try again.");
  await writeAuditLog({
    userId,
    action: "goal.created",
    entityType: "goals",
    details: { title: v.title, period: v.period, goalType: v.goalType },
  });
  return {
    ok: true,
    goal: {
      id: data.id as string,
      title: v.title,
      period: v.period,
      goal_type: v.goalType,
      target_value: v.targetValue,
      target_unit: v.targetUnit,
      start_date: v.startDate,
      end_date: v.endDate,
      status: "active",
    },
  };
}

export type RecordGoalProgressCoreResult =
  | { ok: true; goalId: string; currentValue: number }
  | CoreFailure;

export async function recordGoalProgressCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<RecordGoalProgressCoreResult> {
  const parsed = goalProgressSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const goal = await getGoalById(supabase, userId, parsed.data.goalId);
  if (!goal) return fail("not_found", "That goal was not found.");
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
  if (error) return fail("save_failed", "Could not record your progress. Please try again.");
  // Phase 27: goal progress feeds measured-goal scoring — audit
  // it like goal.created already is.
  await writeAuditLog({
    userId,
    action: "goal.progress_recorded",
    entityType: "goals",
    entityId: goal.id,
    details: { currentValue: parsed.data.currentValue },
  });
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
  return { ok: true, goalId: goal.id, currentValue: parsed.data.currentValue };
}

export type UpdateGoalStatusCoreResult =
  | { ok: true; goalId: string; status: string }
  | CoreFailure;

export async function updateGoalStatusCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<UpdateGoalStatusCoreResult> {
  const parsed = goalStatusSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const goal = await getGoalById(supabase, userId, parsed.data.goalId);
  if (!goal) return fail("not_found", "That goal was not found.");
  const { error } = await supabase
    .from("goals")
    .update({ status: parsed.data.status })
    .eq("id", goal.id);
  if (error) return fail("save_failed", "Could not update your goal. Please try again.");
  // Phase 27: a completion awards XP below — the status change
  // itself belongs in the audit log like goal.created.
  await writeAuditLog({
    userId,
    action: "goal.status_changed",
    entityType: "goals",
    entityId: goal.id,
    details: { status: parsed.data.status },
  });
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
  return { ok: true, goalId: goal.id, status: parsed.data.status };
}
