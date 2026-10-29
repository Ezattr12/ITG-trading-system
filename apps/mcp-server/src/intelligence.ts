import Decimal from "decimal.js";
import {
  calcAvgLoss,
  calcAvgWin,
  calcCurrentStreak,
  calcEquityCurve,
  calcExpectancy,
  calcGoalProgress,
  calcMaxDrawdown,
  calcProfitFactor,
  calcWinRate,
} from "./calc.js";
import {
  NOT_FOUND,
  UpstreamError,
  addDays,
  capText,
  daysBetween,
  fetchActivePlan,
  isValidIsoDate,
  mondayOfWeek,
  num,
  numOr,
  periodWindow,
} from "./common.js";
import type { DbClient } from "./db.js";

/**
 * Stage 4 intelligence tools (design §4): the read-only,
 * bounded aggregations a coach conversation needs —
 * recent trades, performance summaries (overall / by strategy
 * / by session), psychology aggregates, risk status, goal
 * progress, discipline status, level + XP status, and the
 * weekly review.
 *
 * Same security model as the Stage 3 tools (see tools.ts):
 * tenant identity comes only from the validated token, every
 * query runs on the RLS client and additionally filters by
 * the derived user id, unknown arguments are rejected before
 * any query runs, and the dispatcher audits every call.
 *
 * Calculation rule (design §4): every financial figure is
 * produced by an @itg/calc primitive. The only local math is
 * counting rows, grouping them, and Decimal summation of
 * stored values — exactly the composition the web app's
 * summarizeTrades performs around the same primitives, over
 * the same row set (status = 'closed', pnl not null, most
 * recent 500 — lib/analytics/queries.ts getAnalyticsBundle).
 * The scoring engine, the coach insight engine and the risk
 * engine are NOT re-implemented here: those tools read
 * stored state only (see get_level_status / get_risk_status).
 */

export const MAX_RANGE_DAYS = 366;
export const MAX_RECENT_LIMIT = 50;
export const CLOSED_FETCH_LIMIT = 500;
export const MAX_GROUPS = 20;
export const XP_FETCH_LIMIT = 1000;

// ---------------------------------------------------------------- registry types

export interface IntelParseResult {
  invalidMessage: string | null;
  /** The validated argument value (null when invalid). */
  value: unknown;
  /** Non-free-text arguments safe to store in the audit row. */
  auditArgs: Record<string, unknown>;
}

export interface IntelRunResult {
  payload: unknown;
  /** Audit entity id when the tool resolved one stored row. */
  entityId?: string | null;
}

export interface IntelToolSpec {
  entityType: string;
  parse(args: unknown): IntelParseResult;
  run(
    client: DbClient,
    userId: string,
    value: unknown,
  ): Promise<IntelRunResult | typeof NOT_FOUND>;
}

function asRecord(args: unknown): Record<string, unknown> | null {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

function unknownKey(record: Record<string, unknown>, allowed: string[]): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return `unknown argument: ${key}`;
  }
  return null;
}

function invalid(message: string, auditArgs: Record<string, unknown> = {}): IntelParseResult {
  return { invalidMessage: message, value: null, auditArgs };
}

function valid(value: unknown, auditArgs: Record<string, unknown>): IntelParseResult {
  return { invalidMessage: null, value, auditArgs };
}

/** Parser for tools that take no arguments at all. */
function parseNoArgs(args: unknown): IntelParseResult {
  const record = asRecord(args);
  if (!record) return invalid("arguments must be an object");
  const bad = unknownKey(record, []);
  if (bad) return invalid(bad);
  return valid({}, {});
}

interface DateRange {
  from: string;
  to: string;
}

/**
 * Shared { from, to } validation for the period tools: real
 * ISO dates, from on or before to, span at most 366 days.
 * Every failure names the field at fault.
 */
function parseDateRange(args: unknown): IntelParseResult {
  const record = asRecord(args);
  if (!record) return invalid("arguments must be an object");
  const bad = unknownKey(record, ["from", "to"]);
  if (bad) return invalid(bad);
  const { from, to } = record;
  if (from === undefined) return invalid("from is required");
  if (typeof from !== "string" || !isValidIsoDate(from)) {
    return invalid("from must be a valid date (YYYY-MM-DD)");
  }
  if (to === undefined) return invalid("to is required");
  if (typeof to !== "string" || !isValidIsoDate(to)) {
    return invalid("to must be a valid date (YYYY-MM-DD)");
  }
  if (from > to) return invalid("from must be on or before to");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    return invalid(`from/to range must be ${MAX_RANGE_DAYS} days or fewer`);
  }
  return valid({ from, to } satisfies DateRange, { from, to });
}

// ---------------------------------------------------------------- shared trade fetch + summary

interface ClosedTradeRow {
  id: string;
  pair: string;
  direction: string;
  openedAt: string;
  closedAt: string;
  pnl: number;
  rMultiple: number | null;
  strategyId: string | null;
  session: string | null;
}

const CLOSED_TRADE_COLUMNS =
  "id, pair, direction, opened_at, closed_at, pnl, r_multiple, strategy_id, session";

/**
 * The analytics row set, mirroring getAnalyticsBundle:
 * the trader's closed trades with a stored P&L, closed inside
 * [from, to] (UTC days), most recent first, capped at 500.
 * Returned in chronological (close-time ascending) order —
 * the order buildEquityCurve uses for the equity curve.
 */
async function fetchClosedTrades(
  client: DbClient,
  userId: string,
  from: string,
  to: string,
): Promise<{ trades: ClosedTradeRow[]; capped: boolean }> {
  const { data, error } = await client
    .from("trades")
    .select(CLOSED_TRADE_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "closed")
    .not("pnl", "is", null)
    .gte("closed_at", `${from}T00:00:00.000Z`)
    .lte("closed_at", `${to}T23:59:59.999Z`)
    .order("closed_at", { ascending: false })
    .limit(CLOSED_FETCH_LIMIT);
  if (error) throw new UpstreamError("trades query failed");
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    pair: String(r.pair),
    direction: String(r.direction),
    openedAt: String(r.opened_at),
    closedAt: String(r.closed_at),
    pnl: numOr(r.pnl, 0),
    rMultiple: num(r.r_multiple),
    strategyId: r.strategy_id ? String(r.strategy_id) : null,
    session: r.session ? String(r.session) : null,
  }));
  rows.reverse(); // fetched newest-first; computations run chronologically
  return { trades: rows, capped: rows.length >= CLOSED_FETCH_LIMIT };
}

export interface TradeSummaryOut {
  trade_count: number;
  wins: number;
  losses: number;
  breakeven: number;
  net_pnl: number;
  win_rate_pct: number | null;
  loss_rate_pct: number | null;
  avg_win: number | null;
  avg_loss: number | null;
  profit_factor: number | null;
  expectancy: number | null;
  avg_r: number | null;
  max_drawdown: number;
  current_streak: number;
}

/**
 * Mirror of lib/analytics summarizeTrades over the same row
 * set: every figure is an @itg/calc primitive over the
 * trades' stored P&Ls / R multiples; the only local math is
 * counting and the Decimal sum/mean composition the web
 * function itself performs inline. Empty input yields the
 * same honest zeros/nulls (win rate null, drawdown 0).
 * `trades` must be chronological by close time.
 */
export function summarize(trades: readonly ClosedTradeRow[]): TradeSummaryOut {
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const rs = trades
    .map((t) => t.rMultiple)
    .filter((r): r is number => r !== null);
  return {
    trade_count: trades.length,
    wins,
    losses,
    breakeven: pnls.filter((p) => p === 0).length,
    net_pnl: pnls
      .reduce((sum, p) => sum.plus(new Decimal(p)), new Decimal(0))
      .toNumber(),
    win_rate_pct: calcWinRate(pnls),
    loss_rate_pct:
      trades.length === 0
        ? null
        : new Decimal(losses).dividedBy(trades.length).times(100).toNumber(),
    avg_win: calcAvgWin(pnls),
    avg_loss: calcAvgLoss(pnls),
    profit_factor: calcProfitFactor(pnls),
    expectancy: calcExpectancy(pnls),
    avg_r:
      rs.length === 0
        ? null
        : rs
            .reduce((sum, r) => sum.plus(new Decimal(r)), new Decimal(0))
            .dividedBy(rs.length)
            .toNumber(),
    max_drawdown: calcMaxDrawdown(calcEquityCurve(pnls)),
    current_streak: calcCurrentStreak(pnls),
  };
}

function bestWorst(trades: readonly ClosedTradeRow[]): {
  best_trade: { id: string; pair: string; pnl: number } | null;
  worst_trade: { id: string; pair: string; pnl: number } | null;
} {
  if (trades.length === 0) return { best_trade: null, worst_trade: null };
  let best = trades[0];
  let worst = trades[0];
  for (const t of trades) {
    if (t.pnl > best.pnl) best = t;
    if (t.pnl < worst.pnl) worst = t;
  }
  return {
    best_trade: { id: best.id, pair: best.pair, pnl: best.pnl },
    worst_trade: { id: worst.id, pair: worst.pair, pnl: worst.pnl },
  };
}

/** Strategy id → name for the given trades (one bounded `in` query). */
async function strategyNames(
  client: DbClient,
  trades: readonly { strategyId: string | null }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(trades.map((t) => t.strategyId).filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from("strategies")
    .select("id, name")
    .in("id", ids);
  if (error) throw new UpstreamError("strategies query failed");
  return new Map(
    ((data ?? []) as Record<string, unknown>[]).map((s) => [
      String(s.id),
      String(s.name),
    ]),
  );
}

// ---------------------------------------------------------------- 1. get_recent_trades

function parseRecentTrades(args: unknown): IntelParseResult {
  const record = asRecord(args);
  if (!record) return invalid("arguments must be an object");
  const bad = unknownKey(record, ["limit", "pair"]);
  if (bad) return invalid(bad);
  let limit = 10;
  if (record.limit !== undefined) {
    if (
      typeof record.limit !== "number" ||
      !Number.isInteger(record.limit) ||
      record.limit < 1 ||
      record.limit > MAX_RECENT_LIMIT
    ) {
      return invalid(`limit must be an integer between 1 and ${MAX_RECENT_LIMIT}`);
    }
    limit = record.limit;
  }
  let pair: string | null = null;
  if (record.pair !== undefined) {
    if (typeof record.pair !== "string" || record.pair.trim() === "") {
      return invalid("pair must be a non-empty string");
    }
    if (record.pair.length > 30) return invalid("pair must be 30 characters or fewer");
    pair = record.pair.trim();
  }
  // `pair` is free text: it is deliberately NOT recorded in
  // the audit row (design §2.4 — ids and structured values only).
  return valid({ limit, pair }, { limit });
}

async function runRecentTrades(
  client: DbClient,
  userId: string,
  value: unknown,
): Promise<IntelRunResult> {
  const { limit, pair } = value as { limit: number; pair: string | null };
  let query = client
    .from("trades")
    .select("id, pair, direction, status, opened_at, closed_at, pnl, r_multiple, strategy_id")
    .eq("user_id", userId)
    .order("opened_at", { ascending: false })
    .limit(limit + 1); // one extra row detects truncation
  if (pair) query = query.ilike("pair", `%${pair}%`);
  const { data, error } = await query;
  if (error) throw new UpstreamError("trades query failed");
  const rows = ((data ?? []) as Record<string, unknown>[]).slice(0, limit + 1);
  const truncated = rows.length > limit;
  const page = rows.slice(0, limit).map((r) => ({
    id: String(r.id),
    pair: String(r.pair),
    direction: String(r.direction),
    status: String(r.status),
    opened_at: String(r.opened_at),
    closed_at: r.closed_at ? String(r.closed_at) : null,
    pnl: num(r.pnl),
    r_multiple: num(r.r_multiple),
    strategyId: r.strategy_id ? String(r.strategy_id) : null,
  }));
  const names = await strategyNames(client, page);
  return {
    payload: {
      trades: page.map(({ strategyId, ...rest }) => ({
        ...rest,
        strategy_name: strategyId ? (names.get(strategyId) ?? null) : null,
      })),
      pagination: { returned: page.length, limit, truncated },
    },
  };
}

// ---------------------------------------------------------------- 2. get_performance_summary

async function runPerformanceSummary(
  client: DbClient,
  userId: string,
  value: unknown,
): Promise<IntelRunResult> {
  const { from, to } = value as DateRange;
  const { trades, capped } = await fetchClosedTrades(client, userId, from, to);
  return {
    payload: {
      period: { from, to },
      summary: summarize(trades),
      ...bestWorst(trades),
      fetch_capped: capped,
    },
  };
}

// ---------------------------------------------------------------- 3/4. grouped performance

function groupSummaryPayload(
  groups: { key: string; trades: ClosedTradeRow[] }[],
): { groups: unknown[]; groups_total: number; groups_truncated: boolean } {
  const sorted = groups
    .map((g) => ({ key: g.key, summary: summarize(g.trades) }))
    .sort((a, b) => b.summary.net_pnl - a.summary.net_pnl);
  return {
    groups: sorted.slice(0, MAX_GROUPS),
    groups_total: sorted.length,
    groups_truncated: sorted.length > MAX_GROUPS,
  };
}

async function runStrategyPerformance(
  client: DbClient,
  userId: string,
  value: unknown,
): Promise<IntelRunResult> {
  const { from, to } = value as DateRange;
  const { trades, capped } = await fetchClosedTrades(client, userId, from, to);
  const names = await strategyNames(client, trades);
  const byKey = new Map<string, ClosedTradeRow[]>();
  for (const t of trades) {
    const key = t.strategyId ?? "__none__";
    const group = byKey.get(key) ?? [];
    group.push(t);
    byKey.set(key, group);
  }
  const grouped = groupSummaryPayload(
    [...byKey.entries()].map(([key, group]) => ({ key, trades: group })),
  );
  return {
    payload: {
      period: { from, to },
      groups: grouped.groups.map((g) => {
        const { key, summary } = g as { key: string; summary: TradeSummaryOut };
        return {
          strategy_id: key === "__none__" ? null : key,
          // Same label the web breakdown uses for strategy-less trades.
          strategy_name:
            key === "__none__" ? "No strategy" : (names.get(key) ?? null),
          ...summary,
        };
      }),
      groups_total: grouped.groups_total,
      groups_truncated: grouped.groups_truncated,
      fetch_capped: capped,
    },
  };
}

async function runSessionPerformance(
  client: DbClient,
  userId: string,
  value: unknown,
): Promise<IntelRunResult> {
  const { from, to } = value as DateRange;
  const { trades, capped } = await fetchClosedTrades(client, userId, from, to);
  // The session is recorded on the trade row itself
  // (trades.session — the same source as the web app's
  // breakdownBySession via AnalyticTrade.session).
  const byKey = new Map<string, ClosedTradeRow[]>();
  for (const t of trades) {
    const key = t.session ?? "Not Provided";
    const group = byKey.get(key) ?? [];
    group.push(t);
    byKey.set(key, group);
  }
  const grouped = groupSummaryPayload(
    [...byKey.entries()].map(([key, group]) => ({ key, trades: group })),
  );
  return {
    payload: {
      period: { from, to },
      groups: grouped.groups.map((g) => {
        const { key, summary } = g as { key: string; summary: TradeSummaryOut };
        return { session: key, ...summary };
      }),
      groups_total: grouped.groups_total,
      groups_truncated: grouped.groups_truncated,
      fetch_capped: capped,
    },
  };
}

// ---------------------------------------------------------------- 5. get_psychology_summary

const CONFIDENCE_BANDS = ["1-2", "3", "4-5"] as const;

function bandOf(confidence: number): (typeof CONFIDENCE_BANDS)[number] {
  if (confidence <= 2) return "1-2";
  if (confidence === 3) return "3";
  return "4-5";
}

interface PsychAgg {
  trades: number;
  net_pnl: number;
  win_rate_pct: number | null;
}

function aggregatePsych(rows: { pnl: number }[]): PsychAgg {
  return {
    trades: rows.length,
    net_pnl: rows
      .reduce((sum, r) => sum.plus(new Decimal(r.pnl)), new Decimal(0))
      .toNumber(),
    win_rate_pct: calcWinRate(rows.map((r) => r.pnl)),
  };
}

async function runPsychologySummary(
  client: DbClient,
  userId: string,
  value: unknown,
): Promise<IntelRunResult> {
  const { from, to } = value as DateRange;
  const { trades, capped } = await fetchClosedTrades(client, userId, from, to);
  const empty = {
    period: { from, to },
    closed_trades: 0,
    with_psychology_records: 0,
    without_psychology_records: 0,
    by_emotion: [] as unknown[],
    by_confidence_band: CONFIDENCE_BANDS.map((band) => ({
      band,
      trades: 0,
      net_pnl: 0,
      win_rate_pct: null as number | null,
    })),
    by_discipline: [] as unknown[],
    avg_confidence: null as number | null,
    fetch_capped: capped,
  };
  if (trades.length === 0) return { payload: empty };

  const { data, error } = await client
    .from("psychology_records")
    .select("trade_id, confidence, emotion, discipline")
    .eq("user_id", userId)
    .in(
      "trade_id",
      trades.map((t) => t.id),
    );
  if (error) throw new UpstreamError("psychology query failed");
  const psychByTrade = new Map<string, Record<string, unknown>>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const tradeId = String(row.trade_id);
    if (!psychByTrade.has(tradeId)) psychByTrade.set(tradeId, row);
  }

  const joined: {
    pnl: number;
    emotion: string | null;
    confidence: number | null;
    discipline: string | null;
  }[] = [];
  let withRecords = 0;
  for (const t of trades) {
    const psych = psychByTrade.get(t.id);
    if (!psych) continue;
    withRecords += 1;
    joined.push({
      pnl: t.pnl,
      emotion: psych.emotion ? String(psych.emotion) : null,
      confidence: num(psych.confidence),
      discipline: psych.discipline ? String(psych.discipline) : null,
    });
  }

  const groupBy = <K,>(keyOf: (row: (typeof joined)[number]) => K | null) => {
    const map = new Map<K, typeof joined>();
    for (const row of joined) {
      const key = keyOf(row);
      if (key === null) continue;
      const group = map.get(key) ?? [];
      group.push(row);
      map.set(key, group);
    }
    return map;
  };

  const byEmotion = [...groupBy((r) => r.emotion).entries()]
    .map(([emotion, rows]) => ({ emotion, ...aggregatePsych(rows) }))
    .sort((a, b) => b.net_pnl - a.net_pnl);
  const bandGroups = groupBy((r) =>
    r.confidence === null ? null : bandOf(r.confidence),
  );
  const byBand = CONFIDENCE_BANDS.map((band) => ({
    band,
    ...aggregatePsych(bandGroups.get(band) ?? []),
  }));
  const byDiscipline = [...groupBy((r) => r.discipline).entries()]
    .map(([discipline, rows]) => ({ discipline, ...aggregatePsych(rows) }))
    .sort((a, b) => b.net_pnl - a.net_pnl);
  const confidences = joined
    .map((r) => r.confidence)
    .filter((c): c is number => c !== null);

  return {
    payload: {
      period: { from, to },
      closed_trades: trades.length,
      with_psychology_records: withRecords,
      without_psychology_records: trades.length - withRecords,
      by_emotion: byEmotion,
      by_confidence_band: byBand,
      by_discipline: byDiscipline,
      avg_confidence:
        confidences.length === 0
          ? null
          : confidences
              .reduce((sum, c) => sum.plus(new Decimal(c)), new Decimal(0))
              .dividedBy(confidences.length)
              .toNumber(),
      fetch_capped: capped,
    },
  };
}

// ---------------------------------------------------------------- 6. get_risk_status

async function runRiskStatus(
  client: DbClient,
  userId: string,
): Promise<IntelRunResult> {
  const today = new Date().toISOString().slice(0, 10);
  const [rulesRes, plan, eventsRes, openRes] = await Promise.all([
    client
      .from("risk_rules")
      .select(
        "id, plan_id, max_risk_per_trade_pct, max_daily_loss, max_trades_per_day, max_consecutive_losses, max_leverage",
      )
      .eq("user_id", userId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchActivePlan(client, userId),
    client
      .from("risk_events")
      .select("id, severity")
      .eq("user_id", userId)
      .gte("created_at", `${today}T00:00:00.000Z`)
      .lte("created_at", `${today}T23:59:59.999Z`)
      .limit(500),
    client
      .from("risk_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("resolved_at", null),
  ]);
  if (rulesRes.error || eventsRes.error || openRes.error) {
    throw new UpstreamError("risk status query failed");
  }
  const rulesRow = rulesRes.data as Record<string, unknown> | null;
  const bySeverity: Record<string, number> = { warning: 0, critical: 0, positive: 0 };
  let todaysTotal = 0;
  for (const row of (eventsRes.data ?? []) as Record<string, unknown>[]) {
    todaysTotal += 1;
    const severity = String(row.severity);
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
  }
  return {
    payload: {
      date: today,
      // Stored state only — the risk engine is not re-run here.
      rules: rulesRow
        ? {
            id: String(rulesRow.id),
            plan_id: rulesRow.plan_id ? String(rulesRow.plan_id) : null,
            max_risk_per_trade_pct: num(rulesRow.max_risk_per_trade_pct),
            max_daily_loss: num(rulesRow.max_daily_loss),
            max_trades_per_day: num(rulesRow.max_trades_per_day),
            max_consecutive_losses: num(rulesRow.max_consecutive_losses),
            max_leverage: num(rulesRow.max_leverage),
          }
        : null,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            risk_per_trade_pct: plan.risk_per_trade_pct,
            max_daily_loss: plan.max_daily_loss,
            max_daily_trades: plan.max_daily_trades,
          }
        : null,
      todays_events: { total: todaysTotal, by_severity: bySeverity },
      open_events: typeof openRes.count === "number" ? openRes.count : 0,
    },
  };
}

// ---------------------------------------------------------------- 7. get_goal_progress

const MEASURED_TYPES = new Set([
  "max_trades",
  "journal_completion",
  "study_hours",
  "backtesting_sessions",
  "trading_sessions",
]);

interface GoalRow {
  id: string;
  title: string;
  period: string;
  goalType: string;
  targetValue: number;
  targetUnit: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
}

async function runGoalProgress(
  client: DbClient,
  userId: string,
): Promise<IntelRunResult> {
  const today = new Date().toISOString().slice(0, 10);
  const [goalsRes, progressRes] = await Promise.all([
    client
      .from("goals")
      .select("id, title, period, goal_type, target_value, target_unit, start_date, end_date, status")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    client
      .from("goal_progress")
      .select("goal_id, current_value, recorded_date")
      .eq("user_id", userId)
      .order("recorded_date", { ascending: false }),
  ]);
  if (goalsRes.error || progressRes.error) {
    throw new UpstreamError("goals query failed");
  }
  const goals: GoalRow[] = ((goalsRes.data ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      id: String(r.id),
      title: String(r.title),
      period: String(r.period),
      goalType: String(r.goal_type),
      targetValue: numOr(r.target_value, 0),
      targetUnit: r.target_unit ? String(r.target_unit) : null,
      startDate: String(r.start_date).slice(0, 10),
      endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
      status: String(r.status),
    }),
  );
  const manualByGoal = new Map<string, number>();
  for (const row of (progressRes.data ?? []) as Record<string, unknown>[]) {
    const goalId = String(row.goal_id);
    if (!manualByGoal.has(goalId)) {
      manualByGoal.set(goalId, numOr(row.current_value, 0));
    }
  }
  if (goals.length === 0) return { payload: { goals: [], count: 0 } };

  // Measurement context — only fetched when a goal type needs
  // it, mirroring getGoalMeasurementContext's row sets.
  let measuredByGoal = new Map<string, number | null>();
  if (goals.some((g) => MEASURED_TYPES.has(g.goalType))) {
    measuredByGoal = await measureGoals(client, userId, goals, today);
  }

  const out = goals.map((g) => {
    const measured = measuredByGoal.get(g.id);
    let progress: number | null = null;
    let source: "measured" | "manual" | "none" = "none";
    if (measured !== undefined && measured !== null) {
      progress = measured;
      source = "measured";
    } else if (manualByGoal.has(g.id)) {
      progress = manualByGoal.get(g.id) as number;
      source = "manual";
    }
    return {
      id: g.id,
      title: g.title,
      goal_type: g.goalType,
      period: g.period,
      target_value: g.targetValue,
      target_unit: g.targetUnit,
      status: g.status,
      start_date: g.startDate,
      end_date: g.endDate,
      progress,
      percent:
        progress === null
          ? null
          : (calcGoalProgress({ current: progress, target: g.targetValue })?.percent ??
            null),
      progress_source: source,
      // Exact note the task fixes for anything this layer does
      // not measure itself — never an invented number.
      progress_note: progress === null ? "Measured in the app" : null,
    };
  });
  return { payload: { goals: out, count: out.length } };
}

/**
 * The count/sum-based goal measurements, mirroring
 * lib/discipline/engine.ts measureGoal for the goal types
 * that resolve to a count of stored rows or a sum of stored
 * daily-activity counters over the goal's period window:
 * max_trades (trades opened in window), journal_completion
 * (journaled closed trades in window — null when no trade
 * closed in the window, exactly as the engine reports it
 * not measurable), study_hours / backtesting_sessions /
 * trading_sessions (daily_activity sums in window).
 * Other goal types (risk_discipline, performance_target,
 * other) are NOT measured here — see runGoalProgress.
 */
async function measureGoals(
  client: DbClient,
  userId: string,
  goals: GoalRow[],
  today: string,
): Promise<Map<string, number | null>> {
  const [tradesRes, activityRes] = await Promise.all([
    client
      .from("trades")
      .select("id, opened_at, closed_at, status")
      .eq("user_id", userId)
      .order("closed_at", { ascending: false })
      .limit(CLOSED_FETCH_LIMIT),
    client
      .from("daily_activity")
      .select("activity_date, study_hours, backtesting_sessions, trading_sessions_count")
      .eq("user_id", userId)
      .gte("activity_date", addDays(today, -366))
      .order("activity_date", { ascending: false }),
  ]);
  if (tradesRes.error || activityRes.error) {
    throw new UpstreamError("goal measurement query failed");
  }
  const trades = ((tradesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    openedDate: String(r.opened_at).slice(0, 10),
    closedDate: r.closed_at ? String(r.closed_at).slice(0, 10) : null,
    status: String(r.status),
  }));
  const activity = ((activityRes.data ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      date: String(r.activity_date).slice(0, 10),
      studyHours: numOr(r.study_hours, 0),
      backtesting: numOr(r.backtesting_sessions, 0),
      tradingSessions: numOr(r.trading_sessions_count, 0),
    }),
  );

  // Journaled = has a psychology record or a lesson
  // (the app's definition, lib/analytics + lib/discipline).
  const journaledIds = new Set<string>();
  if (trades.length > 0) {
    const ids = trades.map((t) => t.id);
    const [psychRes, lessonsRes] = await Promise.all([
      client.from("psychology_records").select("trade_id").in("trade_id", ids),
      client.from("lessons").select("trade_id").in("trade_id", ids),
    ]);
    if (psychRes.error || lessonsRes.error) {
      throw new UpstreamError("goal journal query failed");
    }
    for (const row of (psychRes.data ?? []) as Record<string, unknown>[]) {
      journaledIds.add(String(row.trade_id));
    }
    for (const row of (lessonsRes.data ?? []) as Record<string, unknown>[]) {
      journaledIds.add(String(row.trade_id));
    }
  }

  const inWindow = (date: string, w: { start: string; end: string }) =>
    date >= w.start && date <= w.end;
  const result = new Map<string, number | null>();
  for (const goal of goals) {
    if (!MEASURED_TYPES.has(goal.goalType)) continue;
    const window = periodWindow(goal.period, today, goal.startDate, goal.endDate);
    switch (goal.goalType) {
      case "max_trades":
        result.set(
          goal.id,
          trades.filter((t) => inWindow(t.openedDate, window)).length,
        );
        break;
      case "journal_completion": {
        const closed = trades.filter(
          (t) =>
            t.status === "closed" &&
            t.closedDate !== null &&
            inWindow(t.closedDate, window),
        );
        result.set(
          goal.id,
          closed.length === 0
            ? null
            : closed.filter((t) => journaledIds.has(t.id)).length,
        );
        break;
      }
      case "study_hours":
      case "backtesting_sessions":
      case "trading_sessions": {
        const pick =
          goal.goalType === "study_hours"
            ? (a: (typeof activity)[number]) => a.studyHours
            : goal.goalType === "backtesting_sessions"
              ? (a: (typeof activity)[number]) => a.backtesting
              : (a: (typeof activity)[number]) => a.tradingSessions;
        const sum = activity
          .filter((a) => inWindow(a.date, window))
          .reduce((s, a) => s.plus(new Decimal(pick(a))), new Decimal(0));
        result.set(goal.id, sum.toNumber());
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------- 8. get_discipline_status

async function runDisciplineStatus(
  client: DbClient,
  userId: string,
): Promise<IntelRunResult> {
  const [eventsRes, unreadRes] = await Promise.all([
    client
      .from("discipline_events")
      .select("id, kind, level, message, event_date, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
    client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false),
  ]);
  if (eventsRes.error || unreadRes.error) {
    throw new UpstreamError("discipline status query failed");
  }
  return {
    payload: {
      // Stored events only — the reminder engine is not re-run.
      recent_events: ((eventsRes.data ?? []) as Record<string, unknown>[]).map(
        (r) => {
          const message = capText(r.message ? String(r.message) : null);
          return {
            id: String(r.id),
            kind: String(r.kind),
            level: num(r.level),
            message: message.text,
            message_truncated: message.truncated,
            event_date: String(r.event_date).slice(0, 10),
            created_at: String(r.created_at),
          };
        },
      ),
      unread_notifications:
        typeof unreadRes.count === "number" ? unreadRes.count : 0,
    },
  };
}

// ---------------------------------------------------------------- 9. get_level_status

async function runLevelStatus(
  client: DbClient,
  userId: string,
): Promise<IntelRunResult> {
  const [levelRes, xpRes] = await Promise.all([
    client
      .from("user_levels")
      .select("level_id, score, score_breakdown, calculated_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("xp_transactions")
      .select("amount, reason, note, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(XP_FETCH_LIMIT),
  ]);
  if (levelRes.error || xpRes.error) {
    throw new UpstreamError("level status query failed");
  }

  let level: unknown = null;
  let levelNote: string | null = null;
  const levelRow = levelRes.data as Record<string, unknown> | null;
  if (levelRow) {
    let levelName: string | null = null;
    if (levelRow.level_id) {
      const { data: levelDef, error: levelDefError } = await client
        .from("levels")
        .select("id, name")
        .eq("id", String(levelRow.level_id))
        .maybeSingle();
      if (levelDefError) throw new UpstreamError("levels query failed");
      if (levelDef) levelName = String((levelDef as Record<string, unknown>).name);
    }
    level = {
      name: levelName,
      score: num(levelRow.score),
      // The stored per-dimension breakdown, exactly as the
      // app last calculated it — never recomputed here.
      score_breakdown:
        levelRow.score_breakdown && typeof levelRow.score_breakdown === "object"
          ? levelRow.score_breakdown
          : {},
      calculated_at: levelRow.calculated_at ? String(levelRow.calculated_at) : null,
      updated_at: levelRow.updated_at ? String(levelRow.updated_at) : null,
    };
  } else {
    levelNote =
      "No stored level yet — the app computes your level from your trades, goals and XP on your next visit.";
  }

  const xpRows = ((xpRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    amount: numOr(r.amount, 0),
    reason: String(r.reason),
    note: r.note ? String(r.note) : null,
    created_at: String(r.created_at),
  }));
  const byReasonMap = new Map<string, { total: number; events: number }>();
  for (const row of xpRows) {
    const entry = byReasonMap.get(row.reason) ?? { total: 0, events: 0 };
    entry.total += row.amount;
    entry.events += 1;
    byReasonMap.set(row.reason, entry);
  }
  return {
    payload: {
      level,
      level_note: levelNote,
      xp: {
        total: xpRows.reduce((sum, r) => sum + r.amount, 0),
        by_reason: [...byReasonMap.entries()]
          .map(([reason, v]) => ({ reason, total_xp: v.total, events: v.events }))
          .sort((a, b) => b.total_xp - a.total_xp || a.reason.localeCompare(b.reason)),
        recent_events: xpRows.slice(0, 10).map((r) => {
          const note = capText(r.note);
          return {
            reason: r.reason,
            amount: r.amount,
            note: note.text,
            note_truncated: note.truncated,
            created_at: r.created_at,
          };
        }),
        events_considered: xpRows.length,
        truncated: xpRows.length >= XP_FETCH_LIMIT,
      },
    },
  };
}

// ---------------------------------------------------------------- 10. get_weekly_review

function parseWeeklyReview(args: unknown): IntelParseResult {
  const record = asRecord(args);
  if (!record) return invalid("arguments must be an object");
  const bad = unknownKey(record, ["week_start"]);
  if (bad) return invalid(bad);
  const raw = record.week_start;
  if (raw === undefined) return invalid("week_start is required");
  if (typeof raw !== "string" || !isValidIsoDate(raw)) {
    return invalid("week_start must be a valid date (YYYY-MM-DD)");
  }
  // Reviews are keyed by the Monday of their week; the app
  // normalizes any submitted date to that Monday
  // (weekBounds/mondayOfWeek in lib/reviews), and so do we.
  const monday = mondayOfWeek(raw);
  return valid({ weekStart: monday }, { week_start: monday });
}

async function runWeeklyReview(
  client: DbClient,
  userId: string,
  value: unknown,
): Promise<IntelRunResult | typeof NOT_FOUND> {
  const { weekStart } = value as { weekStart: string };
  const { data, error } = await client
    .from("weekly_reviews")
    .select(
      "id, week_start_date, week_end_date, trades_count, total_pnl, win_rate_pct, journal_completion_pct, best_strategy, worst_strategy, main_mistake, focus_next_week, review_text, status",
    )
    .eq("user_id", userId)
    .eq("week_start_date", weekStart)
    .maybeSingle();
  if (error) throw new UpstreamError("weekly review query failed");
  if (!data) return NOT_FOUND;
  const row = data as Record<string, unknown>;
  const reviewText = capText(row.review_text ? String(row.review_text) : null);
  const weekEnd = addDays(weekStart, 6);
  const { trades, capped } = await fetchClosedTrades(client, userId, weekStart, weekEnd);
  return {
    entityId: String(row.id),
    payload: {
      week_start: weekStart,
      week_end: row.week_end_date
        ? String(row.week_end_date).slice(0, 10)
        : weekEnd,
      review: {
        id: String(row.id),
        status: String(row.status),
        review_text: reviewText.text,
        review_text_truncated: reviewText.truncated,
        main_mistake: row.main_mistake ? String(row.main_mistake) : null,
        focus_next_week: row.focus_next_week ? String(row.focus_next_week) : null,
        // The aggregates stored when the review was saved.
        stored_aggregates: {
          trades_count: num(row.trades_count),
          total_pnl: num(row.total_pnl),
          win_rate_pct: num(row.win_rate_pct),
          journal_completion_pct: num(row.journal_completion_pct),
          best_strategy: row.best_strategy ? String(row.best_strategy) : null,
          worst_strategy: row.worst_strategy ? String(row.worst_strategy) : null,
        },
      },
      // The same week's trades, recomputed live via @itg/calc.
      week_summary: summarize(trades),
      fetch_capped: capped,
    },
  };
}

// ---------------------------------------------------------------- definitions + registry

const RANGE_SCHEMA = {
  type: "object",
  properties: {
    from: { type: "string", format: "date", description: "First day of the period, YYYY-MM-DD (UTC)." },
    to: { type: "string", format: "date", description: "Last day of the period, YYYY-MM-DD (UTC), at most 366 days after from." },
  },
  required: ["from", "to"],
  additionalProperties: false,
} as const;

const NO_ARGS_SCHEMA = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

const READ_ONLY_SUFFIX =
  "Read-only; the trader is identified by the session token, never by an argument.";

export const INTELLIGENCE_TOOL_DEFINITIONS = [
  {
    name: "get_recent_trades",
    description: `The authenticated trader's most recent trades (all statuses), newest first, with strategy names and pagination metadata. ${READ_ONLY_SUFFIX}`,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many trades to return (default 10)." },
        pair: { type: "string", description: "Optional case-insensitive pair substring filter." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_performance_summary",
    description: `Performance over a period for the authenticated trader's closed trades: counts, win/loss rates, net P&L, profit factor, averages, expectancy, avg R, max drawdown, streak, best/worst trade — all computed with @itg/calc. ${READ_ONLY_SUFFIX}`,
    inputSchema: RANGE_SCHEMA,
  },
  {
    name: "get_strategy_performance",
    description: `The period performance summary grouped per strategy, sorted by net P&L. ${READ_ONLY_SUFFIX}`,
    inputSchema: RANGE_SCHEMA,
  },
  {
    name: "get_session_performance",
    description: `The period performance summary grouped per trading session (trades with no session recorded group as "Not Provided"). ${READ_ONLY_SUFFIX}`,
    inputSchema: RANGE_SCHEMA,
  },
  {
    name: "get_psychology_summary",
    description: `Psychology vs outcome over a period: per-emotion, per-confidence-band and per-discipline aggregates from the trader's psychology records joined to their closed trades, with explicit counts of trades that have no psychology record. ${READ_ONLY_SUFFIX}`,
    inputSchema: RANGE_SCHEMA,
  },
  {
    name: "get_risk_status",
    description: `The trader's current stored risk posture: active risk rules, active trading plan, today's risk events by severity, and the count of unresolved risk events. Stored state only — no engine is re-run. ${READ_ONLY_SUFFIX}`,
    inputSchema: NO_ARGS_SCHEMA,
  },
  {
    name: "get_goal_progress",
    description: `The trader's goals with progress: count/sum-based goal types measured from stored data over the goal's current period window, other goals from their latest recorded progress entry, and an honest "Measured in the app" note where this layer does not measure. ${READ_ONLY_SUFFIX}`,
    inputSchema: NO_ARGS_SCHEMA,
  },
  {
    name: "get_discipline_status",
    description: `The trader's most recent stored discipline events (up to 5) and unread notification count. Stored state only. ${READ_ONLY_SUFFIX}`,
    inputSchema: NO_ARGS_SCHEMA,
  },
  {
    name: "get_level_status",
    description: `The trader's stored level (name, score, per-dimension breakdown, as last calculated by the app) plus XP standing: total, totals by reason, and the 10 most recent XP events. The scoring engine is not re-run. ${READ_ONLY_SUFFIX}`,
    inputSchema: NO_ARGS_SCHEMA,
  },
  {
    name: "get_weekly_review",
    description: `One week's stored weekly review (reflection text capped, main mistake, focus, and the aggregates stored when it was saved) plus a live @itg/calc summary of that week's closed trades. The date is normalized to the Monday of its week, as the app does. ${READ_ONLY_SUFFIX}`,
    inputSchema: {
      type: "object",
      properties: {
        week_start: { type: "string", format: "date", description: "Any date in the target week, YYYY-MM-DD; normalized to the week's Monday." },
      },
      required: ["week_start"],
      additionalProperties: false,
    },
  },
] as const;

export type IntelligenceToolName =
  (typeof INTELLIGENCE_TOOL_DEFINITIONS)[number]["name"];

export const INTELLIGENCE_TOOLS: Record<string, IntelToolSpec> = {
  get_recent_trades: {
    entityType: "trades",
    parse: parseRecentTrades,
    run: runRecentTrades,
  },
  get_performance_summary: {
    entityType: "trades",
    parse: parseDateRange,
    run: runPerformanceSummary,
  },
  get_strategy_performance: {
    entityType: "trades",
    parse: parseDateRange,
    run: runStrategyPerformance,
  },
  get_session_performance: {
    entityType: "trades",
    parse: parseDateRange,
    run: runSessionPerformance,
  },
  get_psychology_summary: {
    entityType: "trades",
    parse: parseDateRange,
    run: runPsychologySummary,
  },
  get_risk_status: {
    entityType: "risk_rules",
    parse: parseNoArgs,
    run: (client, userId) => runRiskStatus(client, userId),
  },
  get_goal_progress: {
    entityType: "goals",
    parse: parseNoArgs,
    run: (client, userId) => runGoalProgress(client, userId),
  },
  get_discipline_status: {
    entityType: "discipline_events",
    parse: parseNoArgs,
    run: (client, userId) => runDisciplineStatus(client, userId),
  },
  get_level_status: {
    entityType: "user_levels",
    parse: parseNoArgs,
    run: (client, userId) => runLevelStatus(client, userId),
  },
  get_weekly_review: {
    entityType: "weekly_reviews",
    parse: parseWeeklyReview,
    run: runWeeklyReview,
  },
};
