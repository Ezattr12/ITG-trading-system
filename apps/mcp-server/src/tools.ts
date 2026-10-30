import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import {
  calcDurationSeconds,
  calcPnl,
  calcRiskAmount,
  calcRiskReward,
  calcRMultiple,
  calcRoi,
  isWin,
} from "./calc.js";
import {
  NOT_FOUND,
  TimeoutError,
  UpstreamError,
  capText,
  fetchActivePlan,
  fetchActiveRules,
  num,
  numOr,
  withTimeout,
} from "./common.js";
import {
  INTELLIGENCE_TOOL_DEFINITIONS,
  INTELLIGENCE_TOOLS,
} from "./intelligence.js";
import {
  COACH_TOOL_DEFINITIONS,
  COACH_TOOLS,
  CoachHttpError,
} from "./coach.js";
import type { McpConfig } from "./config.js";
import type { Authenticator } from "./auth.js";
import { writeAuditLog, type AuditOutcome } from "./audit.js";
import { RateLimiter } from "./ratelimit.js";
import type { DbClient } from "./db.js";

export { TEXT_CAP } from "./common.js";

/**
 * Tool definitions and the call dispatcher.
 *
 * The Stage 3 POC tools `get_trade` and `analyze_trade`
 * (design §3) are implemented in this module. The Stage 4
 * intelligence tools (design §4) live in intelligence.ts and
 * are dispatched through the same caller, so every tool —
 * either stage — shares one security path: tenant identity
 * from the validated access token only (auth.ts), reads on
 * the RLS client with an additional user_id filter, argument
 * validation before any query, the per-user rate limit, the
 * call timeout, and exactly one audit row per call (audit.ts).
 */

export const MAX_LESSONS = 50;
export const CALL_TIMEOUT_MS = 10_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRADE_TOOL_DEFINITIONS = [
  {
    name: "get_trade",
    description:
      "Read one of the authenticated trader's own trades with its journal context (strategy, setup, psychology, lessons, screenshot count, reversal linkage). Read-only. The trader is identified by the session token, never by an argument.",
    inputSchema: {
      type: "object",
      properties: {
        trade_id: { type: "string", format: "uuid", description: "The trade's id." },
      },
      required: ["trade_id"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_trade",
    description:
      "Deterministic, numbers-first analysis of one of the authenticated trader's own trades: stored metrics vs an @itg/calc recomputation (with a metrics_match flag), plan adherence, risk events on the close date, journal completeness, and rule-based findings that cite their numbers. Read-only; no figures are invented.",
    inputSchema: {
      type: "object",
      properties: {
        trade_id: { type: "string", format: "uuid", description: "The trade's id." },
      },
      required: ["trade_id"],
      additionalProperties: false,
    },
  },
] as const;

export const TOOL_DEFINITIONS = [
  ...TRADE_TOOL_DEFINITIONS,
  ...INTELLIGENCE_TOOL_DEFINITIONS,
  ...COACH_TOOL_DEFINITIONS,
];

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export interface ToolCallResult {
  isError: boolean;
  payload: unknown;
}

export interface ToolCallerDeps {
  config: McpConfig;
  authenticator: Authenticator;
  /** Service-role client used ONLY for the audit insert; null disables audit writes. */
  serviceClient: DbClient | null;
  rateLimiter: RateLimiter;
  /** Injectable fetch for the coach endpoint call (tests); defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------- rows

interface TradeRecord {
  id: string;
  user_id: string;
  pair: string;
  direction: "long" | "short";
  entry_price: number;
  exit_price: number | null;
  tp: number | null;
  sl: number | null;
  position_size: number;
  leverage: number;
  fees: number;
  opened_at: string;
  closed_at: string | null;
  status: string;
  strategy_id: string | null;
  setup_id: string | null;
  market_condition: string | null;
  trade_reason: string | null;
  session: string | null;
  notes: string | null;
  pnl: number | null;
  roi_pct: number | null;
  r_multiple: number | null;
  risk_reward: number | null;
  is_win: boolean | null;
  duration_seconds: number | null;
  reversal_trade_id: string | null;
}

const TRADE_COLUMNS =
  "id, user_id, pair, direction, entry_price, exit_price, tp, sl, " +
  "position_size, leverage, fees, opened_at, closed_at, status, " +
  "strategy_id, setup_id, market_condition, trade_reason, session, notes, " +
  "pnl, roi_pct, r_multiple, risk_reward, is_win, duration_seconds, reversal_trade_id";

function normalizeTrade(raw: Record<string, unknown>): TradeRecord {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    pair: String(raw.pair),
    direction: raw.direction === "short" ? "short" : "long",
    entry_price: numOr(raw.entry_price, 0),
    exit_price: num(raw.exit_price),
    tp: num(raw.tp),
    sl: num(raw.sl),
    position_size: numOr(raw.position_size, 0),
    leverage: numOr(raw.leverage, 1),
    fees: numOr(raw.fees, 0),
    opened_at: String(raw.opened_at),
    closed_at: raw.closed_at ? String(raw.closed_at) : null,
    status: String(raw.status),
    strategy_id: raw.strategy_id ? String(raw.strategy_id) : null,
    setup_id: raw.setup_id ? String(raw.setup_id) : null,
    market_condition: raw.market_condition ? String(raw.market_condition) : null,
    trade_reason: raw.trade_reason ? String(raw.trade_reason) : null,
    session: raw.session ? String(raw.session) : null,
    notes: raw.notes ? String(raw.notes) : null,
    pnl: num(raw.pnl),
    roi_pct: num(raw.roi_pct),
    r_multiple: num(raw.r_multiple),
    risk_reward: num(raw.risk_reward),
    is_win: typeof raw.is_win === "boolean" ? raw.is_win : null,
    duration_seconds: num(raw.duration_seconds),
    reversal_trade_id: raw.reversal_trade_id ? String(raw.reversal_trade_id) : null,
  };
}

interface TradeDetailData {
  trade: TradeRecord;
  strategyName: string | null;
  setupName: string | null;
  psychology: {
    confidence: number | null;
    emotion: string | null;
    discipline: string | null;
  } | null;
  lessons: { text: string; is_repeated_mistake: boolean }[];
  lessonsTotal: number;
  screenshotCount: number;
  correctingTrade: { id: string; status: string } | null;
  reversedTrade: { id: string; status: string } | null;
}

/**
 * Fetch one trade + journal context, mirroring the web app's
 * getTradeDetail query pattern (RLS client + explicit user_id
 * filters). Returns null when the trade does not exist OR is
 * not owned by the caller — the two are indistinguishable by
 * design (§2.7, no existence oracle).
 */
async function fetchTradeDetail(
  client: DbClient,
  userId: string,
  tradeId: string,
): Promise<TradeDetailData | null> {
  const { data: tradeData, error: tradeError } = await client
    .from("trades")
    .select(TRADE_COLUMNS)
    .eq("id", tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (tradeError) throw new UpstreamError("trades query failed");
  if (!tradeData) return null;
  const trade = normalizeTrade(tradeData as Record<string, unknown>);

  const [psychRes, lessonsRes, shotsRes, strategyRes, setupRes] = await Promise.all([
    client
      .from("psychology_records")
      .select("confidence, emotion, discipline")
      .eq("trade_id", tradeId)
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("lessons")
      .select("text, is_repeated_mistake, created_at")
      .eq("trade_id", tradeId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(MAX_LESSONS),
    client
      .from("trade_screenshots")
      .select("id", { count: "exact", head: true })
      .eq("trade_id", tradeId)
      .eq("user_id", userId),
    trade.strategy_id
      ? client.from("strategies").select("id, name").eq("id", trade.strategy_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    trade.setup_id
      ? client.from("setups").select("id, name").eq("id", trade.setup_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (psychRes.error || lessonsRes.error || shotsRes.error || strategyRes.error || setupRes.error) {
    throw new UpstreamError("trade context query failed");
  }

  // Reversal linkage — ids + statuses only (mirrors getTradeDetail).
  let correctingTrade: TradeDetailData["correctingTrade"] = null;
  let reversedTrade: TradeDetailData["reversedTrade"] = null;
  if (trade.status === "reversed" && trade.reversal_trade_id) {
    const { data, error } = await client
      .from("trades")
      .select("id, status")
      .eq("id", trade.reversal_trade_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new UpstreamError("reversal query failed");
    if (data) correctingTrade = { id: String(data.id), status: String(data.status) };
  }
  if (trade.status === "closed" || trade.status === "open") {
    const { data, error } = await client
      .from("trades")
      .select("id, status")
      .eq("reversal_trade_id", trade.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new UpstreamError("reversal query failed");
    if (data) reversedTrade = { id: String(data.id), status: String(data.status) };
  }

  const psych = psychRes.data as Record<string, unknown> | null;
  const lessonRows = (lessonsRes.data ?? []) as Record<string, unknown>[];
  return {
    trade,
    strategyName: strategyRes.data ? String((strategyRes.data as { name: unknown }).name) : null,
    setupName: setupRes.data ? String((setupRes.data as { name: unknown }).name) : null,
    psychology: psych
      ? {
          confidence: num(psych.confidence),
          emotion: psych.emotion ? String(psych.emotion) : null,
          discipline: psych.discipline ? String(psych.discipline) : null,
        }
      : null,
    lessons: lessonRows.map((l) => ({
      text: String(l.text ?? ""),
      is_repeated_mistake: l.is_repeated_mistake === true,
    })),
    lessonsTotal: lessonRows.length,
    screenshotCount: typeof shotsRes.count === "number" ? shotsRes.count : 0,
    correctingTrade,
    reversedTrade,
  };
}

// ---------------------------------------------------------------- get_trade

function getTradePayload(detail: TradeDetailData): unknown {
  const t = detail.trade;
  const notes = capText(t.notes);
  return {
    trade: {
      id: t.id,
      pair: t.pair,
      direction: t.direction,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      tp: t.tp,
      sl: t.sl,
      position_size: t.position_size,
      leverage: t.leverage,
      fees: t.fees,
      status: t.status,
      opened_at: t.opened_at,
      closed_at: t.closed_at,
      strategy_id: t.strategy_id,
      setup_id: t.setup_id,
      market_condition: t.market_condition,
      trade_reason: t.trade_reason,
      session: t.session,
      notes: notes.text,
      notes_truncated: notes.truncated,
      metrics: {
        pnl: t.pnl,
        roi_pct: t.roi_pct,
        r_multiple: t.r_multiple,
        risk_reward: t.risk_reward,
        is_win: t.is_win,
        duration_seconds: t.duration_seconds,
      },
    },
    strategy_name: detail.strategyName,
    setup_name: detail.setupName,
    psychology: detail.psychology,
    lessons: detail.lessons.map((l) => {
      const capped = capText(l.text);
      return {
        text: capped.text,
        truncated: capped.truncated,
        is_repeated_mistake: l.is_repeated_mistake,
      };
    }),
    lessons_total: detail.lessonsTotal,
    screenshot_count: detail.screenshotCount,
    reversal: {
      reversal_trade_id: t.reversal_trade_id,
      correcting_trade: detail.correctingTrade,
      reversed_trade: detail.reversedTrade,
    },
  };
}

// ---------------------------------------------------------------- analyze_trade

interface Metrics {
  pnl: number | null;
  roi_pct: number | null;
  r_multiple: number | null;
  risk_reward: number | null;
  is_win: boolean | null;
  duration_seconds: number | null;
}

function storedMetrics(t: TradeRecord): Metrics {
  return {
    pnl: t.pnl,
    roi_pct: t.roi_pct,
    r_multiple: t.r_multiple,
    risk_reward: t.risk_reward,
    is_win: t.is_win,
    duration_seconds: t.duration_seconds,
  };
}

/** Recompute from raw inputs exactly as the web app does (lib/trades/calculations.ts). */
function recomputeMetrics(t: TradeRecord): Metrics {
  const closed = t.exit_price !== null && t.closed_at !== null;
  if (!closed) {
    return {
      pnl: null,
      roi_pct: null,
      r_multiple: null,
      risk_reward: null,
      is_win: null,
      duration_seconds: null,
    };
  }
  const pnl = calcPnl({
    direction: t.direction,
    entryPrice: t.entry_price,
    exitPrice: t.exit_price as number,
    positionSize: t.position_size,
    fees: t.fees,
  });
  const riskAmount = calcRiskAmount({
    entryPrice: t.entry_price,
    stopLoss: t.sl,
    positionSize: t.position_size,
  });
  return {
    pnl,
    roi_pct: calcRoi({
      pnl,
      entryPrice: t.entry_price,
      positionSize: t.position_size,
      leverage: t.leverage,
    }),
    r_multiple: calcRMultiple({ pnl, riskAmount }),
    risk_reward: calcRiskReward({
      direction: t.direction,
      entryPrice: t.entry_price,
      stopLoss: t.sl,
      takeProfit: t.tp,
    }),
    is_win: isWin(pnl),
    duration_seconds: calcDurationSeconds(t.opened_at, t.closed_at),
  };
}

/**
 * Compare a stored metric against the recomputation at the
 * storage precision: trades metrics live in numeric(19,6)
 * columns, so both sides are rounded to 6 decimal places and
 * compared as Decimals — drift beyond storage rounding is a
 * real mismatch, reported, never hidden.
 */
function metricFieldMatches(
  stored: number | boolean | null,
  recomputed: number | boolean | null,
): boolean {
  if (stored === null && recomputed === null) return true;
  if (stored === null || recomputed === null) return false;
  if (typeof stored === "boolean" || typeof recomputed === "boolean") {
    return stored === recomputed;
  }
  return new Decimal(stored)
    .toDecimalPlaces(6)
    .equals(new Decimal(recomputed).toDecimalPlaces(6));
}

interface RiskEventRow {
  id: string;
  type: string;
  severity: string;
  message: string;
  created_at: string;
}

async function fetchRiskEventsOnDate(
  client: DbClient,
  userId: string,
  dateUtc: string,
): Promise<RiskEventRow[]> {
  const { data, error } = await client
    .from("risk_events")
    .select("id, type, severity, message, created_at")
    .eq("user_id", userId)
    .gte("created_at", `${dateUtc}T00:00:00.000Z`)
    .lte("created_at", `${dateUtc}T23:59:59.999Z`)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new UpstreamError("risk events query failed");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    type: String(r.type),
    severity: String(r.severity),
    message: String(r.message),
    created_at: String(r.created_at),
  }));
}

interface Finding {
  rule: string;
  severity: "positive" | "info" | "warning";
  message: string;
  evidence: Record<string, unknown>;
}

async function analyzeTradePayload(
  client: DbClient,
  userId: string,
  detail: TradeDetailData,
): Promise<unknown> {
  const t = detail.trade;
  const stored = storedMetrics(t);
  const recomputed = recomputeMetrics(t);
  const mismatches = (Object.keys(stored) as (keyof Metrics)[]).filter(
    (field) => !metricFieldMatches(stored[field], recomputed[field]),
  );
  const metricsMatch = mismatches.length === 0;

  const [plan, rules] = await Promise.all([
    fetchActivePlan(client, userId),
    fetchActiveRules(client, userId),
  ]);

  const riskAmount = calcRiskAmount({
    entryPrice: t.entry_price,
    stopLoss: t.sl,
    positionSize: t.position_size,
  });
  // Position risk % needs a capital base. The trading plan
  // carries none, so the percentage is honestly reported as
  // not computable rather than guessed (design §3.2).
  const riskPctNote =
    riskAmount === null
      ? "not computable: no stop loss recorded, so the risk amount is undefined"
      : "not computable: the active plan provides no capital base";

  const planAdherence = {
    plan: plan ? { id: plan.id, name: plan.name } : null,
    rules_present: rules !== null,
    stop_loss_present: t.sl !== null,
    take_profit_present: t.tp !== null,
    leverage: {
      trade: t.leverage,
      rules_max: rules?.max_leverage ?? null,
      within_rules_limit:
        rules?.max_leverage == null ? null : t.leverage <= rules.max_leverage,
    },
    position_risk: {
      risk_amount: riskAmount,
      risk_pct_of_capital: null as number | null,
      risk_pct_note: riskPctNote,
      plan_risk_per_trade_pct: plan?.risk_per_trade_pct ?? null,
      rules_max_risk_per_trade_pct: rules?.max_risk_per_trade_pct ?? null,
    },
  };

  const closeDate = t.closed_at ? t.closed_at.slice(0, 10) : null;
  const riskEvents = closeDate
    ? await fetchRiskEventsOnDate(client, userId, closeDate)
    : [];
  const riskContext = {
    close_date: closeDate,
    events: riskEvents,
    count: riskEvents.length,
    note: closeDate ? null : "trade is not closed — no close date to check",
  };

  const present = {
    strategy: t.strategy_id !== null,
    session: t.session !== null,
    emotion: detail.psychology?.emotion != null,
    confidence: detail.psychology?.confidence != null,
    discipline: detail.psychology?.discipline != null,
    lesson: detail.lessonsTotal > 0,
    notes: t.notes !== null && t.notes.trim() !== "",
    screenshot: detail.screenshotCount > 0,
  };
  const missing = Object.entries(present)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  const journalCompleteness = { present, missing, complete: missing.length === 0 };

  const findings: Finding[] = [];
  if (!metricsMatch) {
    findings.push({
      rule: "metrics_drift",
      severity: "warning",
      message: `Stored metrics disagree with a recomputation from the trade's raw inputs on: ${mismatches.join(", ")}.`,
      evidence: { mismatches, stored, recomputed },
    });
  }
  if (t.sl === null) {
    findings.push({
      rule: "no_stop_loss",
      severity: "warning",
      message:
        "No stop loss recorded — the risk amount and R multiple cannot be computed for this trade.",
      evidence: { entry_price: t.entry_price, position_size: t.position_size, sl: null },
    });
  }
  if (t.tp === null) {
    findings.push({
      rule: "no_take_profit",
      severity: "info",
      message: "No take profit recorded — the planned risk-reward cannot be verified.",
      evidence: { entry_price: t.entry_price, tp: null },
    });
  }
  if (rules?.max_leverage != null && t.leverage > rules.max_leverage) {
    findings.push({
      rule: "leverage_above_limit",
      severity: "warning",
      message: `Leverage ${t.leverage} exceeds the active risk-rules maximum of ${rules.max_leverage}.`,
      evidence: { leverage: t.leverage, max_leverage: rules.max_leverage },
    });
  }
  const rr = t.risk_reward ?? recomputed.risk_reward;
  if (rr !== null && rr < 1) {
    findings.push({
      rule: "risk_reward_below_one",
      severity: "warning",
      message: `Planned risk-reward is ${rr}:1 — the trade risked more than its planned reward.`,
      evidence: { risk_reward: rr, entry_price: t.entry_price, tp: t.tp, sl: t.sl },
    });
  }
  const rMultiple = t.r_multiple ?? recomputed.r_multiple;
  if (rMultiple !== null && rMultiple >= 2) {
    findings.push({
      rule: "strong_r_multiple",
      severity: "positive",
      message: `Trade returned ${rMultiple}R — at least twice the amount risked.`,
      evidence: { r_multiple: rMultiple, pnl: t.pnl ?? recomputed.pnl, risk_amount: riskAmount },
    });
  }
  if (rMultiple !== null && rMultiple <= -1) {
    findings.push({
      rule: "full_r_loss",
      severity: "warning",
      message: `Trade lost ${rMultiple}R — a full planned-risk loss or worse.`,
      evidence: { r_multiple: rMultiple, pnl: t.pnl ?? recomputed.pnl, risk_amount: riskAmount },
    });
  }
  if (detail.psychology?.discipline === "poor") {
    findings.push({
      rule: "poor_discipline",
      severity: "warning",
      message: "The trader rated discipline on this trade as poor.",
      evidence: { discipline: "poor", emotion: detail.psychology?.emotion ?? null },
    });
  }
  if (
    detail.psychology?.emotion === "revenge" ||
    detail.psychology?.emotion === "fomo"
  ) {
    findings.push({
      rule: "emotional_entry",
      severity: "warning",
      message: `The recorded emotion for this trade was "${detail.psychology.emotion}".`,
      evidence: {
        emotion: detail.psychology.emotion,
        confidence: detail.psychology.confidence ?? null,
        pnl: t.pnl ?? recomputed.pnl,
      },
    });
  }
  if (missing.length > 0) {
    findings.push({
      rule: "journal_incomplete",
      severity: "info",
      message: `Journal is missing ${missing.length} field(s): ${missing.join(", ")}.`,
      evidence: { missing },
    });
  }
  if (riskEvents.length > 0) {
    findings.push({
      rule: "risk_events_on_close_date",
      severity: "info",
      message: `${riskEvents.length} risk event(s) were recorded on the trade's close date (${closeDate}).`,
      evidence: {
        close_date: closeDate,
        event_types: riskEvents.map((e) => e.type),
      },
    });
  }

  return {
    trade_id: t.id,
    pair: t.pair,
    status: t.status,
    metrics: { stored, recomputed, metrics_match: metricsMatch, mismatches },
    plan_adherence: planAdherence,
    risk_context: riskContext,
    journal_completeness: journalCompleteness,
    findings,
  };
}

// ---------------------------------------------------------------- call dispatch

export function errorPayload(code: string, message: string): unknown {
  return { error: { code, message } };
}

export interface ParsedArgs {
  tradeId: string | null;
  invalidMessage: string | null;
}

/**
 * Validate tool arguments: an object whose ONLY key is a
 * UUID-shaped `trade_id`. Any extra key — above all a smuggled
 * `user_id`/`tenant_id` — is rejected before any query runs
 * (design §2.1, §2.5).
 */
export function parseTradeIdArg(args: unknown): ParsedArgs {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { tradeId: null, invalidMessage: "arguments must be an object" };
  }
  const record = args as Record<string, unknown>;
  const rawId = record.trade_id;
  const supplied =
    typeof rawId === "string" && UUID_RE.test(rawId) ? rawId : null;
  for (const key of Object.keys(record)) {
    if (key !== "trade_id") {
      return {
        tradeId: supplied,
        invalidMessage: `unknown argument: ${key}`,
      };
    }
  }
  if (rawId === undefined) {
    return { tradeId: null, invalidMessage: "trade_id is required" };
  }
  if (supplied === null) {
    return { tradeId: null, invalidMessage: "trade_id must be a uuid" };
  }
  return { tradeId: supplied, invalidMessage: null };
}

export function createToolCaller(deps: ToolCallerDeps) {
  const { config, authenticator, serviceClient, rateLimiter } = deps;

  async function runTool(
    name: ToolName,
    client: DbClient,
    userId: string,
    tradeId: string,
  ): Promise<unknown> {
    const detail = await fetchTradeDetail(client, userId, tradeId);
    if (!detail) return NOT_FOUND;
    if (name === "get_trade") return getTradePayload(detail);
    return analyzeTradePayload(client, userId, detail);
  }

  return async function callTool(name: string, args: unknown): Promise<ToolCallResult> {
    const started = Date.now();
    const correlationId = randomUUID();
    const parsed = parseTradeIdArg(args);
    const isKnownTool = TOOL_DEFINITIONS.some((t) => t.name === name);
    // Stage 4 tools validate through their own parsers and run
    // through the same auth/rate-limit/audit path below.
    const intelSpec = INTELLIGENCE_TOOLS[name];
    const intelParsed = intelSpec ? intelSpec.parse(args) : null;
    // Phase 20: compute_coach_insights validates the same way
    // but runs as an HTTP call to the web app's internal coach
    // endpoint (coach.ts) — no coach logic lives in this server.
    const coachSpec = COACH_TOOLS[name];
    const coachParsed = coachSpec ? coachSpec.parse(args) : null;
    const specParsed = intelParsed ?? coachParsed;
    const specEntityType = intelSpec?.entityType ?? coachSpec?.entityType;

    interface AuditOverrides {
      entityType?: string;
      entityId?: string | null;
      arguments?: Record<string, unknown>;
    }

    const finish = async (
      outcome: AuditOutcome,
      userId: string | null,
      result: ToolCallResult,
      audit?: AuditOverrides,
    ): Promise<ToolCallResult> => {
      await writeAuditLog(serviceClient, {
        userId,
        action: isKnownTool ? `mcp.${name}` : "mcp.unknown_tool",
        entityType:
          audit?.entityType ?? (isKnownTool ? "trades" : "unknown"),
        entityId: audit?.entityId !== undefined ? audit.entityId : parsed.tradeId,
        tool: name.slice(0, 64),
        outcome,
        durationMs: Date.now() - started,
        tradeId: parsed.tradeId,
        arguments: audit?.arguments,
        correlationId,
      });
      return result;
    };
    const fail = (
      code: AuditOutcome & string,
      message: string,
      userId: string | null,
      audit?: AuditOverrides,
    ) =>
      finish(
        code,
        userId,
        {
          isError: true,
          payload: errorPayload(code, message),
        },
        audit,
      );

    if (!isKnownTool) {
      return fail("invalid_argument", `unknown tool: ${name}`, null);
    }
    if (!config.configured) {
      return fail(
        "upstream_error",
        "upstream_error: not_configured (SUPABASE_URL / SUPABASE_ANON_KEY missing)",
        null,
      );
    }

    let auth: Awaited<ReturnType<Authenticator["authenticate"]>>;
    try {
      auth = await authenticator.authenticate(config.accessToken || undefined);
    } catch {
      return fail(
        "upstream_error",
        `upstream_error: authentication check failed (ref ${correlationId})`,
        null,
      );
    }
    if (!auth) {
      return fail(
        "unauthenticated",
        "unauthenticated: missing or invalid access token",
        null,
      );
    }
    if (!rateLimiter.allow(auth.userId)) {
      return fail(
        "rate_limited",
        "rate_limited: more than 60 calls per minute for this trader",
        auth.userId,
      );
    }
    if (specParsed) {
      if (specParsed.invalidMessage) {
        return fail(
          "invalid_argument",
          `invalid_argument: ${specParsed.invalidMessage}`,
          auth.userId,
          {
            entityType: specEntityType,
            entityId: null,
            arguments: specParsed.auditArgs,
          },
        );
      }
    } else if (parsed.invalidMessage || !parsed.tradeId) {
      return fail(
        "invalid_argument",
        `invalid_argument: ${parsed.invalidMessage ?? "trade_id must be a uuid"}`,
        auth.userId,
      );
    }

    try {
      if (coachSpec && coachParsed) {
        const outcome = await withTimeout(
          coachSpec.run(
            {
              fetchImpl: deps.fetchImpl ?? fetch,
              baseUrl: config.apiBaseUrl,
              accessToken: config.accessToken,
            },
            coachParsed.value,
          ),
          CALL_TIMEOUT_MS,
        );
        return finish(
          "ok",
          auth.userId,
          { isError: false, payload: outcome.payload },
          {
            entityType: coachSpec.entityType,
            entityId: null,
            arguments: coachParsed.auditArgs,
          },
        );
      }
      if (intelSpec && intelParsed) {
        const outcome = await withTimeout(
          intelSpec.run(auth.client, auth.userId, intelParsed.value),
          CALL_TIMEOUT_MS,
        );
        if (outcome === NOT_FOUND) {
          return fail("not_found", "not_found: no such record", auth.userId, {
            entityType: intelSpec.entityType,
            entityId: null,
            arguments: intelParsed.auditArgs,
          });
        }
        return finish(
          "ok",
          auth.userId,
          { isError: false, payload: outcome.payload },
          {
            entityType: intelSpec.entityType,
            entityId: outcome.entityId ?? null,
            arguments: intelParsed.auditArgs,
          },
        );
      }
      const payload = await withTimeout(
        runTool(name as ToolName, auth.client, auth.userId, parsed.tradeId as string),
        CALL_TIMEOUT_MS,
      );
      if (payload === NOT_FOUND) {
        return fail("not_found", "not_found: no such trade", auth.userId);
      }
      return finish("ok", auth.userId, { isError: false, payload });
    } catch (err) {
      if (coachSpec && coachParsed && err instanceof CoachHttpError) {
        return fail(err.code, `${err.code}: ${err.message}`, auth.userId, {
          entityType: coachSpec.entityType,
          entityId: null,
          arguments: coachParsed.auditArgs,
        });
      }
      if (err instanceof TimeoutError) {
        return fail("upstream_error", "upstream_error: timeout", auth.userId);
      }
      return fail(
        "upstream_error",
        `upstream_error: data source failure (ref ${correlationId})`,
        auth.userId,
      );
    }
  };
}
