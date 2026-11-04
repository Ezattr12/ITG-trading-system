import type { SupabaseClient } from "@supabase/supabase-js";
import { calcRiskAmount } from "@itg/calc";
import { createNotification } from "@/lib/discipline/service";
import { getTradingPlan } from "@/lib/risk/queries";
import { utcDate } from "@/lib/risk/engine";
import type { TradingPlan } from "@/lib/risk/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/trades/queries";
import { evaluateTradeAgainstPlan, planEventDay } from "./engine";
import {
  PLAN_DAY_TERMS,
  type PlanDayContext,
  type PlanTerm,
  type PlanTradeInput,
  type PlanVerdict,
} from "./types";

/**
 * Plan enforcement service (Task 19) — the write side of the
 * pure engine in lib/plan/engine.ts.
 *
 * Enforcement is OBSERVATIONAL and best-effort, exactly like
 * the risk-event writer it mirrors (logRiskEvent): a failure
 * here never blocks, fails or changes a trade save. Both
 * entry points swallow errors and return counts of what was
 * actually written.
 *
 * Two callers:
 * - createTradeCore (lib/trades/service.ts), post-insert:
 *   `evaluatePlanForTrade` judges the just-saved trade. One
 *   hook covers web + mobile, because both adapters share
 *   the core. Corrections / edits / reviews do NOT call it —
 *   consistent with risk evaluation, which also runs only at
 *   creation.
 * - The Task 17 background pass: `runPlanEnforcementForUser`
 *   re-judges every open/closed trade's trade-level terms
 *   (this is what catches session/setup breaches, which only
 *   become visible once an advanced review records those
 *   fields) and today's trades' day-level terms.
 *
 * Dedupe is structural (migration 0019): one event per
 * (user, trade, term) for trade-level terms, one per
 * (user, day, term) for day-level terms. The writer checks
 * existence before inserting; the partial unique indexes are
 * the backstop, and a conflict is treated as "already
 * logged", never as an error.
 */

export interface PlanEnforcementCounts {
  events: number;
  notifications: number;
}

const ZERO: PlanEnforcementCounts = { events: 0, notifications: 0 };

const TRADE_COLUMNS =
  "id, pair, session, setup_id, sl, entry_price, position_size, pnl, status, opened_at, closed_at, created_at";

interface TradeRowShape {
  id: string;
  pair: string;
  session: PlanTradeInput["session"];
  setup_id: string | null;
  sl: number | string | null;
  entry_price: number | string;
  position_size: number | string;
  pnl: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  created_at?: string;
}

/* ------------------------------------------------------- writer */

/**
 * Log one plan breach event. Returns the new row's id, or
 * null when the event already exists (dedupe) or the write
 * failed. Mirrors logRiskEvent: service-role insert (the
 * table has no client INSERT policy — append-only), returns
 * a plain result instead of throwing.
 */
export async function logPlanEvent(input: {
  userId: string;
  planId: string | null;
  tradeId: string | null;
  term: PlanTerm;
  eventDay: string | null;
  message: string;
  details?: Record<string, unknown>;
}): Promise<string | null> {
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return null;

  // Structural dedupe, checked before the insert; the
  // migration's partial unique indexes are the backstop.
  let existing = admin
    .from("plan_events")
    .select("id")
    .eq("user_id", input.userId)
    .eq("term", input.term);
  existing = PLAN_DAY_TERMS.includes(input.term)
    ? existing.eq("event_day", input.eventDay)
    : existing.eq("trade_id", input.tradeId);
  const { data: found } = await existing.limit(1);
  if ((found ?? []).length > 0) return null;

  const { data, error } = await admin
    .from("plan_events")
    .insert({
      user_id: input.userId,
      plan_id: input.planId,
      trade_id: input.tradeId,
      term: input.term,
      event_day: input.eventDay,
      message: input.message,
      details: input.details ?? {},
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/* -------------------------------------------------- preparation */

/** The trader's recorded trading capital (profiles), or null. */
async function getTradingCapital(
  client: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { data } = await client
    .from("profiles")
    .select("trading_capital")
    .eq("id", userId)
    .maybeSingle();
  const capital = (data as { trading_capital: number | null } | null)
    ?.trading_capital;
  return capital !== null && capital !== undefined && Number(capital) > 0
    ? Number(capital)
    : null;
}

/**
 * Prepare the engine's trade input from a stored row. The
 * risk figure is derived exactly as createTradeCore derives
 * it for the risk engine — calcRiskAmount(entry, sl, size)
 * over the profile's trading capital — and is null whenever
 * any input is missing or non-numeric, so the risk term
 * becomes not_evaluable rather than guessed.
 */
export function preparePlanTrade(
  row: TradeRowShape,
  capital: number | null,
): PlanTradeInput {
  let riskPct: number | null = null;
  const entry = Number(row.entry_price);
  const size = Number(row.position_size);
  const sl = row.sl === null ? null : Number(row.sl);
  if (
    capital !== null &&
    sl !== null &&
    Number.isFinite(entry) &&
    Number.isFinite(size) &&
    Number.isFinite(sl)
  ) {
    try {
      const riskAmount = calcRiskAmount({
        entryPrice: entry,
        stopLoss: sl,
        positionSize: size,
      });
      if (riskAmount !== null) riskPct = (riskAmount / capital) * 100;
    } catch {
      riskPct = null;
    }
  }
  return {
    id: row.id,
    pair: row.pair,
    session: row.session,
    setupId: row.setup_id,
    riskPct,
    pnl: row.pnl === null ? null : Number(row.pnl),
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

function byOpenOrder(
  a: TradeRowShape,
  b: TradeRowShape,
): number {
  return (
    a.opened_at.localeCompare(b.opened_at) ||
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Build the day context for one trade from stored rows: the
 * ordered ids of trades opened on the trade's opened day
 * (cancelled/reversed excluded — the same population the
 * risk engine's buildDayContext counts) and the ordered
 * closed trades of its closed day. The sort is applied here
 * (opened_at, created_at, id) so the ordinal/crossing logic
 * sees one deterministic order on every client.
 */
export async function buildPlanDayContext(
  client: SupabaseClient,
  userId: string,
  trade: PlanTradeInput,
): Promise<PlanDayContext> {
  const openedDay = utcDate(trade.openedAt);
  const { data: openedRows } = await client
    .from("trades")
    .select(TRADE_COLUMNS)
    .eq("user_id", userId)
    .gte("opened_at", `${openedDay}T00:00:00Z`)
    .lte("opened_at", `${openedDay}T23:59:59.999Z`);
  const opened = ((openedRows ?? []) as TradeRowShape[])
    .filter((r) => r.status !== "cancelled" && r.status !== "reversed")
    .sort(byOpenOrder);

  let closedDayTrades: PlanDayContext["closedDayTrades"] = [];
  if (trade.closedAt) {
    const closedDay = utcDate(trade.closedAt);
    const { data: closedRows } = await client
      .from("trades")
      .select(TRADE_COLUMNS)
      .eq("user_id", userId)
      .eq("status", "closed")
      .gte("closed_at", `${closedDay}T00:00:00Z`)
      .lte("closed_at", `${closedDay}T23:59:59.999Z`);
    closedDayTrades = ((closedRows ?? []) as TradeRowShape[])
      .filter((r) => r.pnl !== null)
      .sort(
        (a, b) =>
          String(a.closed_at).localeCompare(String(b.closed_at)) ||
          String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
          a.id.localeCompare(b.id),
      )
      .map((r) => ({ id: r.id, pnl: Number(r.pnl) }));
  }

  return {
    openedDayTradeIds: opened.map((r) => r.id),
    closedDayTrades,
  };
}

/* ------------------------------------------------------ logging */

/**
 * Persist the breached verdicts of one evaluation: one
 * plan_events row per breach (deduped) and one notification
 * per NEW row. The notification kind is `system` — see
 * docs/task-19-plan-enforcement.md for why plan breaches are
 * not risk_warning — and it points at the plan event so the
 * notifications page can deep-link it to /plan.
 */
export async function logPlanVerdicts(input: {
  userId: string;
  plan: TradingPlan;
  trade: PlanTradeInput;
  verdicts: PlanVerdict[];
}): Promise<PlanEnforcementCounts> {
  const counts: PlanEnforcementCounts = { ...ZERO };
  for (const verdict of input.verdicts) {
    if (verdict.status !== "breached") continue;
    const eventId = await logPlanEvent({
      userId: input.userId,
      planId: input.plan.id,
      tradeId: input.trade.id,
      term: verdict.term,
      eventDay: planEventDay(verdict.term, input.trade),
      message: verdict.message,
      details: { value: verdict.value, limit: verdict.limit },
    });
    if (!eventId) continue;
    counts.events += 1;
    const notified = await createNotification({
      userId: input.userId,
      type: "system",
      title: "Trading plan breach",
      body: verdict.message,
      relatedEntityType: "plan_event",
      relatedEntityId: eventId,
    });
    if (notified) counts.notifications += 1;
  }
  return counts;
}

/* --------------------------------------------------- entry points */

/**
 * Judge one stored trade against the trader's active plan
 * and log + notify any breaches. The createTradeCore hook:
 * post-insert, best-effort, never throws. Cancelled and
 * reversed trades are never judged (they are excluded from
 * every statistic by status, plan enforcement included).
 */
export async function evaluatePlanForTrade(
  client: SupabaseClient,
  userId: string,
  tradeId: string,
): Promise<PlanEnforcementCounts> {
  try {
    const plan = await getTradingPlan(client, userId);
    if (!plan) return { ...ZERO };
    const { data } = await client
      .from("trades")
      .select(TRADE_COLUMNS)
      .eq("id", tradeId)
      .eq("user_id", userId)
      .maybeSingle();
    const row = (data ?? null) as TradeRowShape | null;
    if (!row || row.status === "cancelled" || row.status === "reversed") {
      return { ...ZERO };
    }
    const capital = await getTradingCapital(client, userId);
    const trade = preparePlanTrade(row, capital);
    const context = await buildPlanDayContext(client, userId, trade);
    const verdicts = evaluateTradeAgainstPlan(trade, plan, context);
    return await logPlanVerdicts({ userId, plan, trade, verdicts });
  } catch {
    return { ...ZERO };
  }
}

/**
 * The background-pass section: re-judge every open/closed
 * trade's trade-level terms against the active plan, plus
 * the day-level terms of trades opened or closed today.
 * Idempotent — a second run logs nothing new, because every
 * breach it finds is already stored (the dedupe check in
 * logPlanEvent). Never throws.
 */
export async function runPlanEnforcementForUser(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<PlanEnforcementCounts> {
  const counts: PlanEnforcementCounts = { ...ZERO };
  try {
    const plan = await getTradingPlan(client, userId);
    if (!plan) return counts;
    const capital = await getTradingCapital(client, userId);
    // Task 21: the pass re-judges the trader's trades, so it
    // pages through ALL of them (fetchAllRows) — breaches on
    // trades older than the newest 500 can no longer be
    // silently skipped.
    const allRows = await fetchAllRows<TradeRowShape>((from, to) =>
      client
        .from("trades")
        .select(TRADE_COLUMNS)
        .eq("user_id", userId)
        .order("opened_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: TradeRowShape[] | null }>,
    );
    const rows = allRows.filter(
      (r) => r.status !== "cancelled" && r.status !== "reversed",
    );
    const today = now.toISOString().slice(0, 10);
    for (const row of rows) {
      try {
        const trade = preparePlanTrade(row, capital);
        const touchesToday =
          utcDate(trade.openedAt) === today ||
          (trade.closedAt !== null && utcDate(trade.closedAt) === today);
        // Day terms judge the trade's own day; for trades
        // that don't touch today they are history the Plan
        // page already summarises (evaluatePlanVsActual), so
        // only today's trades get a day context — older
        // trades are judged on trade-level terms alone.
        const context = touchesToday
          ? await buildPlanDayContext(client, userId, trade)
          : null;
        const verdicts = evaluateTradeAgainstPlan(trade, plan, context);
        const logged = await logPlanVerdicts({
          userId,
          plan,
          trade,
          verdicts,
        });
        counts.events += logged.events;
        counts.notifications += logged.notifications;
      } catch {
        // One bad trade never starves the rest of the pass.
        continue;
      }
    }
    return counts;
  } catch {
    return counts;
  }
}
