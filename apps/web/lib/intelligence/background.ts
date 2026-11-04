import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import { refreshCoachInsights } from "@/lib/coach/service";
import { COACH_MIN_TRADES } from "@/lib/coach/types";
import { weekBounds } from "@/lib/reviews/reviews";
import {
  createNotification,
  ensureDisciplineReminderLoggedCore,
} from "@/lib/discipline/service";
import { runPlanEnforcementForUser } from "@/lib/plan/service";
import { getLastJournalDate } from "@/lib/discipline/queries";
import { fetchAllRows } from "@/lib/trades/queries";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Background Intelligence Engine (Task 17).
 *
 * One input → many automatic outputs: a trader's stored trades
 * already drive the coach insights, risk surfaces and discipline
 * reminders, but until now every one of those outputs was only
 * produced while the trader was looking at a page (a dashboard
 * render, a manual refresh, a trade save). This module is the
 * scheduled pass that produces the same outputs with nobody
 * watching, so the intelligence is fresh before the trader
 * arrives.
 *
 * The pass is strictly a RE-USE of the existing writers — it
 * introduces no new write path:
 * - ai_insights are written only by `refreshCoachInsights`
 *   (lib/coach/service.ts), the same idempotent persist the
 *   manual refresh and the trade-close trigger use.
 * - notifications are written only by `createNotification`
 *   (lib/discipline/service.ts).
 * - discipline events are written only by `logDisciplineEvent`,
 *   reached through the shared escalation core
 *   (`ensureDisciplineReminderLoggedCore`) that the dashboard
 *   render also calls.
 * - plan breach events are written only by `logPlanEvent`
 *   (lib/plan/service.ts, Task 19), reached through the same
 *   `runPlanEnforcementForUser` the trade-save hook's engine
 *   feeds; plan dedupe is structural per (trade, term) /
 *   (day, term) in migration 0019.
 *
 * IDEMPOTENCY IS THE CONTRACT: a second run started
 * immediately after the first creates zero new rows of any
 * kind. Each section dedupes structurally, never by timing:
 * - insights: the staleness signal (below) turns false once a
 *   refresh has snapshotted the current evidence,
 *   `refreshCoachInsights` itself refuses duplicate snapshots,
 *   a week below the coach evidence minimum is never attempted,
 *   and a refresh is only counted when a newer snapshot
 *   actually exists afterwards.
 * - risk notifications: one per risk event, keyed by the
 *   notification's related-entity fields (type + entity id).
 * - discipline: the escalation check never logs the same
 *   level twice for one missed run (the table's unique key
 *   on (user_id, event_date, kind, level) backs this up).
 * - monthly notice: at most one per user per calendar month,
 *   checked by existence before creating.
 *
 * Cross-user work happens only here, server-side, with the
 * service-role client; every read and write is scoped to the
 * user being processed. No figures are invented: notification
 * copy uses the stored risk event's own message and real
 * period names only.
 */

export interface UserBackgroundPassResult {
  /**
   * True only when the refresh left a NEWER insight snapshot
   * stored than existed before it — an invocation that stored
   * nothing (duplicate snapshot, insufficient data) is false.
   */
  insightsRefreshed: boolean;
  riskNotifications: number;
  disciplineEvents: number;
  monthlyNotices: number;
  /** Plan breach events logged by plan enforcement (Task 19). */
  planEvents: number;
  /** Notifications created for those plan breaches. */
  planNotifications: number;
}

export interface BackgroundRunSummary {
  usersProcessed: number;
  /** How many users gained a newer stored insight snapshot. */
  insightsRefreshed: number;
  riskNotifications: number;
  disciplineEvents: number;
  monthlyNotices: number;
  planEvents: number;
  planNotifications: number;
  /** Users whose pass threw; the run continues past them. */
  errors: number;
}

const EMPTY_USER_RESULT: UserBackgroundPassResult = {
  insightsRefreshed: false,
  riskNotifications: 0,
  disciplineEvents: 0,
  monthlyNotices: 0,
  planEvents: 0,
  planNotifications: 0,
};

function todayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/* ------------------------------------------------- insights freshness */

/**
 * Staleness signal: the newest closed trade's `updated_at`
 * (bumped by the trades trigger on create, correction and
 * in-place review saves — every write path that changes coach
 * evidence) compared with the newest stored insight's
 * `created_at`. Evidence newer than the latest snapshot means
 * the snapshot may be stale, so the week containing that
 * trade is refreshed. A user with no closed trades is a
 * no-op (there is nothing to analyse, and any stored insights
 * belong to weeks whose trades were since reversed).
 *
 * Two guards keep the signal honest:
 *
 * - Threshold gate: the refresh is never attempted when the
 *   target week holds fewer than `COACH_MIN_TRADES` closed
 *   trades (see the inline comment at the gate).
 * - Truthful counting: the return value is not "the refresh
 *   ran" — it is "a newer insight snapshot exists now than
 *   existed before the call". A refresh that stored nothing
 *   (the week's snapshot was already stored, so every insight
 *   was a duplicate) reports false, so the run summary and
 *   the audit row never overstate what the pass produced.
 *   (First production runs, 2026-11-02, counted invocations
 *   and reported a refresh for a user whose refresh provably
 *   wrote zero rows — on every run, forever.)
 */
async function refreshInsightsIfStale(
  client: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: tradeRows } = await client
    .from("trades")
    .select("updated_at, closed_at, opened_at")
    .eq("user_id", userId)
    .eq("status", "closed")
    .order("updated_at", { ascending: false })
    .limit(1);
  const newest = (tradeRows ?? [])[0] as
    | { updated_at: string; closed_at: string | null; opened_at: string }
    | undefined;
  if (!newest) return false;

  const { data: insightRows } = await client
    .from("ai_insights")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latestInsight = (insightRows ?? [])[0] as
    | { created_at: string }
    | undefined;
  const latestInsightAt = latestInsight?.created_at;
  if (
    latestInsightAt &&
    Date.parse(newest.updated_at) <= Date.parse(latestInsightAt)
  ) {
    return false;
  }

  // Threshold gate. `refreshCoachInsights` can only write a
  // row when the week it analyses clears the coach engine's
  // evidence minimum: `generateCoachInsights` (lib/coach/
  // insights.ts) returns `insufficientData` with zero insights
  // below `COACH_MIN_TRADES` (3, lib/coach/types.ts) closed
  // trades in the analysed week, and the refresh then inserts
  // nothing. This pass refreshes exactly one week — the one
  // containing the newest closed trade — and the coach
  // evidence counts that week's closed trades by `closed_at`
  // within the Monday–Sunday bounds (`getReportSummary` via
  // `getCoachWeekData`), so the gate counts the same set the
  // engine would see. Below the minimum the attempt is a
  // guaranteed no-op; without the gate, a sub-threshold user
  // (e.g. 1 closed trade, no insights — so the comparison
  // above can never turn fresh) fired it on every run.
  const weekDate = (newest.closed_at ?? newest.opened_at).slice(0, 10);
  const bounds = weekBounds(weekDate);
  if (!bounds) return false;
  const { data: weekTradeRows } = await client
    .from("trades")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("closed_at", `${bounds.start}T00:00:00Z`)
    .lte("closed_at", `${bounds.end}T23:59:59Z`)
    .limit(COACH_MIN_TRADES);
  if ((weekTradeRows ?? []).length < COACH_MIN_TRADES) return false;

  // The refresh normalises the date to its week's Monday and
  // is idempotent: unchanged evidence stores nothing new.
  await refreshCoachInsights({
    supabase: client,
    admin: client,
    userId,
    weekStartDate: weekDate,
  });

  // Truthful counting: refreshed means a NEWER snapshot
  // exists after the call than before it. (The service's own
  // `inserted` count agrees by construction — a row is only
  // inserted with `created_at = now()`, newer than any
  // pre-call snapshot — but the stored state is the ground
  // truth the audit should report.)
  const { data: afterRows } = await client
    .from("ai_insights")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const afterInsight = (afterRows ?? [])[0] as
    | { created_at: string }
    | undefined;
  if (!afterInsight) return false;
  if (!latestInsight) return true;
  if (afterInsight.created_at && latestInsightAt) {
    return Date.parse(afterInsight.created_at) > Date.parse(latestInsightAt);
  }
  return afterInsight.created_at !== latestInsightAt;
}

/* ------------------------------------------------ risk notifications */

const RISK_TITLES: Record<string, string> = {
  critical: "Critical risk event",
  warning: "Risk warning",
  positive: "Positive risk streak",
};

/**
 * One `risk_warning` notification per risk event, ever. The
 * dedupe is structural: before creating, the pass loads the
 * ids of events already notified for this user (notifications
 * of type `risk_warning` with related entity `risk_event`)
 * and skips them. The body is the event's own stored message
 * — the risk engine's words, with its real figures — never
 * re-worded or re-computed here.
 */
async function notifyUnnotifiedRiskEvents(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  // Task 21: the events read pages through ALL of the user's
  // risk events (fetchAllRows). It previously stopped at the
  // oldest 500, so once those were notified, later events
  // could never notify at all.
  const [events, existingRes] = await Promise.all([
    fetchAllRows<{ id: string; severity: string; message: string }>((from, to) =>
      client
        .from("risk_events")
        .select("id, severity, message")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
          data: { id: string; severity: string; message: string }[] | null;
        }>,
    ),
    client
      .from("notifications")
      .select("related_entity_id")
      .eq("user_id", userId)
      .eq("type", "risk_warning")
      .eq("related_entity_type", "risk_event"),
  ]);
  const notified = new Set(
    ((existingRes.data ?? []) as { related_entity_id: string | null }[])
      .map((r) => r.related_entity_id)
      .filter((id): id is string => typeof id === "string"),
  );
  let created = 0;
  for (const event of events) {
    if (notified.has(event.id)) continue;
    const ok = await createNotification({
      userId,
      type: "risk_warning",
      title: RISK_TITLES[event.severity] ?? "Risk warning",
      body: event.message,
      relatedEntityType: "risk_event",
      relatedEntityId: event.id,
    });
    if (ok) {
      created += 1;
      notified.add(event.id);
    }
  }
  return created;
}

/* ------------------------------------------------------ discipline */

/**
 * The missed-journal escalation, run without a dashboard
 * render: same core the render calls, fed with the same
 * inputs (the trader's last journaled day, today). At most
 * one event can be logged per pass — an escalation step.
 */
async function runDisciplineEscalation(
  client: SupabaseClient,
  userId: string,
  today: string,
): Promise<number> {
  const lastJournalDate = await getLastJournalDate(client, userId);
  const result = await ensureDisciplineReminderLoggedCore(
    client,
    userId,
    lastJournalDate,
    today,
  );
  return result.logged ? 1 : 0;
}

/* --------------------------------------------------- monthly notice */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "Your October report is ready" — issued on the first pass
 * of a new calendar month (UTC) when the trader closed at
 * least one trade in the month just completed. Dedupe is an
 * existence check: a `monthly_report` notification created
 * in the current month means this month's notice (which is
 * always about the previous month) already went out.
 * `related_entity_id` stays null — monthly reports are
 * computed views, not stored rows, so there is no row id to
 * reference; the type marker is `report`.
 */
async function notifyMonthlyReportIfDue(
  client: SupabaseClient,
  userId: string,
  now: Date,
): Promise<number> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const currentMonthStart = new Date(Date.UTC(year, month, 1))
    .toISOString()
    .slice(0, 10);

  const { data: existing } = await client
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "monthly_report")
    .gte("created_at", `${currentMonthStart}T00:00:00Z`)
    .limit(1);
  if ((existing ?? []).length > 0) return 0;

  const prevStart = new Date(Date.UTC(year, month - 1, 1));
  const prevEnd = new Date(Date.UTC(year, month, 0));
  const prevStartStr = prevStart.toISOString().slice(0, 10);
  const prevEndStr = prevEnd.toISOString().slice(0, 10);
  const { data: trades } = await client
    .from("trades")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("closed_at", `${prevStartStr}T00:00:00Z`)
    .lte("closed_at", `${prevEndStr}T23:59:59Z`)
    .limit(1);
  if ((trades ?? []).length === 0) return 0;

  const monthName = MONTH_NAMES[prevStart.getUTCMonth()];
  const label = `${monthName} ${prevStart.getUTCFullYear()}`;
  const ok = await createNotification({
    userId,
    type: "monthly_report",
    title: `Your ${monthName} report is ready`,
    body: `Your trading report for ${label} is ready — open Reports to review the month.`,
    relatedEntityType: "report",
    relatedEntityId: null,
  });
  return ok ? 1 : 0;
}

/* ------------------------------------------------------------ pass */

/** Run the full background pass for one trader. */
export async function runBackgroundPassForUser(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<UserBackgroundPassResult> {
  const result: UserBackgroundPassResult = { ...EMPTY_USER_RESULT };
  // The notification sections run first: if the coach refresh
  // ever throws for this user, the runner counts the error and
  // the notifications have still landed (the next run retries
  // the refresh).
  result.riskNotifications = await notifyUnnotifiedRiskEvents(client, userId);
  result.disciplineEvents = await runDisciplineEscalation(
    client,
    userId,
    todayString(now),
  );
  result.monthlyNotices = await notifyMonthlyReportIfDue(client, userId, now);
  // Plan enforcement (Task 19): re-judge stored trades
  // against the active plan — catches session/setup breaches
  // recorded by later reviews, and today's day-limit
  // crossings from any path. Never throws (best-effort like
  // every writer here) and idempotent by structural dedupe.
  const plan = await runPlanEnforcementForUser(client, userId, now);
  result.planEvents = plan.events;
  result.planNotifications = plan.notifications;
  result.insightsRefreshed = await refreshInsightsIfStale(client, userId);
  return result;
}

/**
 * Run the pass for every profile. A failure for one user is
 * counted and skipped — one bad account must never starve
 * the rest of the run.
 */
export async function runBackgroundPassForAllUsers(
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<BackgroundRunSummary> {
  const summary: BackgroundRunSummary = {
    usersProcessed: 0,
    insightsRefreshed: 0,
    riskNotifications: 0,
    disciplineEvents: 0,
    monthlyNotices: 0,
    planEvents: 0,
    planNotifications: 0,
    errors: 0,
  };
  const { data } = await client
    .from("profiles")
    .select("id")
    .order("id", { ascending: true });
  for (const row of (data ?? []) as { id: string }[]) {
    try {
      const result = await runBackgroundPassForUser(client, row.id, now);
      summary.usersProcessed += 1;
      if (result.insightsRefreshed) summary.insightsRefreshed += 1;
      summary.riskNotifications += result.riskNotifications;
      summary.disciplineEvents += result.disciplineEvents;
      summary.monthlyNotices += result.monthlyNotices;
      summary.planEvents += result.planEvents;
      summary.planNotifications += result.planNotifications;
    } catch {
      summary.errors += 1;
    }
  }
  return summary;
}

/* --------------------------------------------------- run endpoint */

/**
 * Constant-time bearer-secret check. Both sides are hashed
 * first so the comparison never leaks the secret's length
 * and `timingSafeEqual` always sees equal-length buffers.
 */
export function isAuthorisedRun(
  authorization: string | null,
  secret: string,
): boolean {
  if (!authorization || !secret) return false;
  if (!authorization.startsWith("Bearer ")) return false;
  const presented = authorization.slice("Bearer ".length).trim();
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export interface IntelligenceRunDeps {
  getSecret: () => string | undefined;
  createAdminClient: () => SupabaseClient | null;
  runAll: (client: SupabaseClient) => Promise<BackgroundRunSummary>;
  writeRunAudit: (summary: BackgroundRunSummary) => Promise<boolean>;
}

export function createDefaultIntelligenceRunDeps(): IntelligenceRunDeps {
  return {
    getSecret: () => process.env.INTELLIGENCE_CRON_SECRET,
    createAdminClient: () => createServiceRoleSupabaseClient(),
    runAll: (client) => runBackgroundPassForAllUsers(client),
    writeRunAudit: (summary) =>
      writeAuditLog({
        action: "intelligence.background_run",
        entityType: "intelligence",
        details: {
          usersProcessed: summary.usersProcessed,
          insightsRefreshed: summary.insightsRefreshed,
          riskNotifications: summary.riskNotifications,
          disciplineEvents: summary.disciplineEvents,
          monthlyNotices: summary.monthlyNotices,
          planEvents: summary.planEvents,
          planNotifications: summary.planNotifications,
          errors: summary.errors,
        },
      }),
  };
}

/**
 * POST/GET /api/intelligence/run — the scheduled entry point.
 *
 * Authorisation is the shared secret ONLY: a normal user
 * session (cookie or Bearer token) must never trigger a
 * cross-user run, so the session is not even consulted.
 * Missing env, missing header and wrong secret all return
 * the same detail-free 401. Success returns counts only —
 * no user ids, no figures, nothing about any trader.
 */
export async function handleIntelligenceRun(
  input: { authorization: string | null },
  deps: IntelligenceRunDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = deps.getSecret();
  if (!secret || !isAuthorisedRun(input.authorization, secret)) {
    return { status: 401, body: { error: "unauthorised" } };
  }
  const client = deps.createAdminClient();
  if (!client) {
    return { status: 503, body: { error: "unavailable" } };
  }
  const summary = await deps.runAll(client);
  await deps.writeRunAudit(summary);
  return {
    status: 200,
    body: {
      ok: true,
      usersProcessed: summary.usersProcessed,
      insightsRefreshed: summary.insightsRefreshed,
      riskNotifications: summary.riskNotifications,
      disciplineEvents: summary.disciplineEvents,
      monthlyNotices: summary.monthlyNotices,
      planEvents: summary.planEvents,
      planNotifications: summary.planNotifications,
      errors: summary.errors,
    },
  };
}
