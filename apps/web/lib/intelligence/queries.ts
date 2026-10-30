import type { SupabaseClient } from "@supabase/supabase-js";
import { calcRiskAmount } from "@itg/calc";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/types";
import { getReportSummary } from "@/lib/reports/queries";
import { periodBounds } from "@/lib/reports/reports";
import { getCoachWeekData } from "@/lib/coach/queries";
import { generateCoachInsights } from "@/lib/coach/insights";
import type { AiInsightRow } from "@/lib/coach/types";
import { mondayOfWeek, weekBounds } from "@/lib/reviews/reviews";
import { getRiskEvents, getRiskRules, getTradingPlan } from "@/lib/risk/queries";
import type { RiskEvent, RiskRules, TradingPlan } from "@/lib/risk/types";
import {
  analyzeConditions,
  analyzeDiscipline,
  analyzeDrawdown,
  analyzePsychology,
  analyzeRecurring,
  analyzeRiskBehavior,
  buildImprovementPlan,
  type RiskContext,
} from "./analysis";
import type {
  ConditionsAnalysis,
  DisciplineAnalysis,
  DrawdownAnalysis,
  ImprovementPlan,
  IntelLesson,
  IntelTrade,
  IntelligenceOverview,
  PeriodDigest,
  PsychologyAnalysis,
  RecurringAnalysis,
  RiskBehaviorAnalysis,
} from "./types";

/**
 * Advanced Trading Intelligence — reads (Phase 23).
 *
 * Server Components / coach cores call these with the
 * signed-in user's Supabase client, so RLS enforces
 * isolation, and every query additionally filters
 * `user_id` — the same defence-in-depth pattern as
 * lib/analytics and lib/reports. No service-role client is
 * used for reads.
 *
 * Known limit (carried from Phases 3–5): intelligence runs
 * over at most the 500 most recent closed trades.
 */

export interface IntelligenceData {
  trades: IntelTrade[];
  lessons: IntelLesson[];
  rules: RiskRules | null;
  plan: TradingPlan | null;
  /** `profiles.trading_capital` (> 0) when on file, else null. */
  capital: number | null;
  riskEvents: RiskEvent[];
}

/**
 * One read of everything the intelligence analyses need:
 * closed trades with their psychology / strategy / setup
 * joins (mirroring `getAnalyticsBundle`'s composition, plus
 * the raw fields that bundle drops), the trader's lessons,
 * active risk rules and plan, trading capital, and stored
 * risk events. Planned risk per trade comes from
 * `calcRiskAmount` — the same primitive the trade engine
 * used for the stored R multiple.
 */
export async function getIntelligenceData(
  supabase: SupabaseClient,
  userId: string,
): Promise<IntelligenceData> {
  const { data: tradeRows } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "closed")
    .not("pnl", "is", null)
    .order("closed_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  const trades = (tradeRows ?? []) as TradeRow[];
  const tradeIds = trades.map((t) => t.id);

  const [psychRes, strategiesRes, setupsRes, lessonsRes, rules, plan, profileRes, riskEvents] =
    await Promise.all([
      tradeIds.length > 0
        ? supabase
            .from("psychology_records")
            .select("trade_id, confidence, emotion, discipline")
            .in("trade_id", tradeIds)
        : Promise.resolve({ data: [] }),
      tradeIds.length > 0
        ? supabase
            .from("strategies")
            .select("id, name")
            .in("id", trades.map((t) => t.strategy_id).filter(Boolean) as string[])
        : Promise.resolve({ data: [] }),
      tradeIds.length > 0
        ? supabase
            .from("setups")
            .select("id, name")
            .in("id", trades.map((t) => t.setup_id).filter(Boolean) as string[])
        : Promise.resolve({ data: [] }),
      supabase
        .from("lessons")
        .select("trade_id, text, is_repeated_mistake")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(TRADE_LIST_FETCH_LIMIT),
      getRiskRules(supabase, userId),
      getTradingPlan(supabase, userId),
      supabase
        .from("profiles")
        .select("trading_capital")
        .eq("id", userId)
        .maybeSingle(),
      getRiskEvents(supabase, userId, TRADE_LIST_FETCH_LIMIT),
    ]);

  const psychByTrade = new Map(
    ((psychRes.data ?? []) as {
      trade_id: string;
      confidence: number | null;
      emotion: IntelTrade["emotion"];
      discipline: IntelTrade["discipline"];
    }[]).map((p) => [p.trade_id, p]),
  );
  const strategyName = new Map(
    ((strategiesRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  const setupName = new Map(
    ((setupsRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  const lessons = ((lessonsRes.data ?? []) as {
    trade_id: string | null;
    text: string;
    is_repeated_mistake: boolean;
  }[]).map(
    (l): IntelLesson => ({
      tradeId: l.trade_id,
      text: l.text ?? "",
      repeatedMistake: Boolean(l.is_repeated_mistake),
    }),
  );
  const lessonTradeIds = new Set(
    lessons.map((l) => l.tradeId).filter((id): id is string => id !== null),
  );
  const capitalRaw = (profileRes.data as { trading_capital: number | null } | null)
    ?.trading_capital;

  const intelTrades: IntelTrade[] = trades.map((t) => {
    const psych = psychByTrade.get(t.id);
    return {
      id: t.id,
      pair: t.pair,
      direction: t.direction,
      session: t.session,
      strategyName: t.strategy_id ? strategyName.get(t.strategy_id) ?? null : null,
      pnl: t.pnl ?? 0,
      rMultiple: t.r_multiple,
      closedAt: t.closed_at ?? t.opened_at,
      openedAt: t.opened_at,
      emotion: psych?.emotion ?? null,
      discipline: psych?.discipline ?? null,
      confidence: psych?.confidence ?? null,
      journaled: Boolean(psych) || lessonTradeIds.has(t.id),
      stopLossSet: t.sl !== null,
      setupName: t.setup_id ? setupName.get(t.setup_id) ?? null : null,
      marketCondition: t.market_condition,
      tradeReason: t.trade_reason,
      leverage: t.leverage,
      riskAmount: calcRiskAmount({
        entryPrice: t.entry_price,
        stopLoss: t.sl,
        positionSize: t.position_size,
      }),
    };
  });

  return {
    trades: intelTrades,
    lessons,
    rules,
    plan,
    capital: capitalRaw !== null && capitalRaw !== undefined && capitalRaw > 0 ? capitalRaw : null,
    riskEvents,
  };
}

function riskContext(data: IntelligenceData, today: string): RiskContext {
  return {
    rules: data.rules,
    plan: data.plan,
    capital: data.capital,
    riskEvents: data.riskEvents,
    today,
  };
}

function planFromData(data: IntelligenceData, today: string): ImprovementPlan {
  return buildImprovementPlan({
    tradesCount: data.trades.length,
    drawdown: analyzeDrawdown(data.trades),
    risk: analyzeRiskBehavior(data.trades, riskContext(data, today)),
    recurring: analyzeRecurring(data.trades, data.lessons),
    discipline: analyzeDiscipline(data.trades),
    psychology: analyzePsychology(data.trades),
    conditions: analyzeConditions(data.trades),
  });
}

/* --------------------------------------------------------- service cores */

export async function getDrawdownAnalysis(
  supabase: SupabaseClient,
  userId: string,
): Promise<DrawdownAnalysis> {
  const data = await getIntelligenceData(supabase, userId);
  return analyzeDrawdown(data.trades);
}

export async function getRiskBehaviorAnalysis(
  supabase: SupabaseClient,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<RiskBehaviorAnalysis> {
  const data = await getIntelligenceData(supabase, userId);
  return analyzeRiskBehavior(data.trades, riskContext(data, today));
}

export async function getPsychologyAnalysis(
  supabase: SupabaseClient,
  userId: string,
): Promise<PsychologyAnalysis> {
  const data = await getIntelligenceData(supabase, userId);
  return analyzePsychology(data.trades);
}

export async function getDisciplineAnalysis(
  supabase: SupabaseClient,
  userId: string,
): Promise<DisciplineAnalysis> {
  const data = await getIntelligenceData(supabase, userId);
  return analyzeDiscipline(data.trades);
}

export async function getRecurringAnalysis(
  supabase: SupabaseClient,
  userId: string,
): Promise<RecurringAnalysis> {
  const data = await getIntelligenceData(supabase, userId);
  return analyzeRecurring(data.trades, data.lessons);
}

export async function getConditionsAnalysis(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConditionsAnalysis> {
  const data = await getIntelligenceData(supabase, userId);
  return analyzeConditions(data.trades);
}

export async function getImprovementPlan(
  supabase: SupabaseClient,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<ImprovementPlan> {
  const data = await getIntelligenceData(supabase, userId);
  return planFromData(data, today);
}

/* ---------------------------------------------------------------- digests */

interface DigestAnalyses {
  drawdown: DrawdownAnalysis;
  psychology: PsychologyAnalysis;
  discipline: DisciplineAnalysis;
  recurring: RecurringAnalysis;
  focus: ImprovementPlan["actions"];
}

function sliceAnalyses(
  data: IntelligenceData,
  periodStart: string,
  periodEnd: string,
  today: string,
): DigestAnalyses {
  const slice = data.trades.filter(
    (t) => t.closedAt.slice(0, 10) >= periodStart && t.closedAt.slice(0, 10) <= periodEnd,
  );
  const sliceIds = new Set(slice.map((t) => t.id));
  const sliceLessons = data.lessons.filter(
    (l) => l.tradeId !== null && sliceIds.has(l.tradeId),
  );
  const plan = buildImprovementPlan({
    tradesCount: slice.length,
    drawdown: analyzeDrawdown(slice),
    risk: analyzeRiskBehavior(slice, riskContext(data, today)),
    recurring: analyzeRecurring(slice, sliceLessons),
    discipline: analyzeDiscipline(slice),
    psychology: analyzePsychology(slice),
    conditions: analyzeConditions(slice),
  });
  return {
    drawdown: analyzeDrawdown(slice),
    psychology: analyzePsychology(slice),
    discipline: analyzeDiscipline(slice),
    recurring: analyzeRecurring(slice, sliceLessons),
    focus: plan.status === "ok" ? plan.actions.slice(0, 3) : [],
  };
}

async function buildDigest(
  supabase: SupabaseClient,
  userId: string,
  kind: "weekly" | "monthly",
  periodStart: string,
  periodEnd: string,
  today: string,
): Promise<PeriodDigest> {
  const summary = await getReportSummary(supabase, userId, {
    type: kind,
    periodStart,
    periodEnd,
  });
  const emptyAnalyses: DigestAnalyses = {
    drawdown: analyzeDrawdown([]),
    psychology: analyzePsychology([]),
    discipline: analyzeDiscipline([]),
    recurring: analyzeRecurring([], []),
    focus: [],
  };
  if (summary.tradesCount === 0) {
    return {
      kind,
      periodStart,
      periodEnd,
      status: "insufficient_data",
      tradesCount: 0,
      totalPnl: 0,
      winRate: null,
      recommendations: summary.recommendations,
      ...emptyAnalyses,
      coachFindings: [],
    };
  }

  const data = await getIntelligenceData(supabase, userId);
  const analyses = sliceAnalyses(data, periodStart, periodEnd, today);

  let coachFindings: PeriodDigest["coachFindings"] = [];
  if (kind === "weekly") {
    const weekData = await getCoachWeekData(supabase, userId, periodStart);
    if (weekData) {
      const analysis = generateCoachInsights(weekData);
      if (!analysis.insufficientData) {
        coachFindings = analysis.insights.map((i) => ({
          title: i.title,
          recommendation: i.metricsSnapshot.recommendation,
        }));
      }
    }
  } else {
    const { data: insightRows } = await supabase
      .from("ai_insights")
      .select("*")
      .eq("user_id", userId)
      .gte("period_start", periodStart)
      .lte("period_end", periodEnd)
      .order("generated_at", { ascending: false })
      .limit(10);
    coachFindings = ((insightRows ?? []) as AiInsightRow[]).map((r) => ({
      title: r.summary,
      recommendation: r.metrics_snapshot?.recommendation ?? "",
    }));
  }

  return {
    kind,
    periodStart,
    periodEnd,
    status: "ok",
    tradesCount: summary.tradesCount,
    totalPnl: summary.totalPnl,
    winRate: summary.winRate,
    recommendations: summary.recommendations,
    ...analyses,
    coachFindings,
  };
}

/**
 * Automated weekly review digest for the week containing
 * `anchor` (default today): the week's report summary,
 * within-week intelligence, the improvement focus, and the
 * deterministic Coach Engine's own findings for that week.
 * Computed on read — see docs/phase-23.md for why digests
 * are not persisted.
 */
export async function getWeeklyDigest(
  supabase: SupabaseClient,
  userId: string,
  anchor?: string,
): Promise<PeriodDigest | null> {
  const today = new Date().toISOString().slice(0, 10);
  const monday = mondayOfWeek(anchor ?? today);
  if (!monday) return null;
  const bounds = weekBounds(monday);
  if (!bounds) return null;
  return buildDigest(supabase, userId, "weekly", bounds.start, bounds.end, today);
}

/** Automated monthly performance review digest (see above). */
export async function getMonthlyDigest(
  supabase: SupabaseClient,
  userId: string,
  anchor?: string,
): Promise<PeriodDigest | null> {
  const today = new Date().toISOString().slice(0, 10);
  const bounds = periodBounds("monthly", anchor ?? today);
  if (!bounds) return null;
  return buildDigest(supabase, userId, "monthly", bounds.start, bounds.end, today);
}

/* --------------------------------------------------------------- overview */

/** Everything the Analytics intelligence section renders, in one pass. */
export async function getIntelligenceOverview(
  supabase: SupabaseClient,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<IntelligenceOverview> {
  const data = await getIntelligenceData(supabase, userId);
  const drawdown = analyzeDrawdown(data.trades);
  const risk = analyzeRiskBehavior(data.trades, riskContext(data, today));
  const psychology = analyzePsychology(data.trades);
  const discipline = analyzeDiscipline(data.trades);
  const recurring = analyzeRecurring(data.trades, data.lessons);
  const conditions = analyzeConditions(data.trades);
  const plan = buildImprovementPlan({
    tradesCount: data.trades.length,
    drawdown,
    risk,
    recurring,
    discipline,
    psychology,
    conditions,
  });
  const [weeklyDigest, monthlyDigest] = await Promise.all([
    getWeeklyDigest(supabase, userId, today),
    getMonthlyDigest(supabase, userId, today),
  ]);
  return {
    tradesCount: data.trades.length,
    drawdown,
    risk,
    psychology,
    discipline,
    recurring,
    conditions,
    plan,
    // `today` is always a valid ISO date here, so the digest
    // builders cannot actually return null on this path.
    weeklyDigest: weeklyDigest ?? emptyDigest("weekly", today, today),
    monthlyDigest: monthlyDigest ?? emptyDigest("monthly", today, today),
  };
}

function emptyDigest(
  kind: "weekly" | "monthly",
  periodStart: string,
  periodEnd: string,
): PeriodDigest {
  return {
    kind,
    periodStart,
    periodEnd,
    status: "insufficient_data",
    tradesCount: 0,
    totalPnl: 0,
    winRate: null,
    recommendations: [],
    drawdown: analyzeDrawdown([]),
    psychology: analyzePsychology([]),
    discipline: analyzeDiscipline([]),
    recurring: analyzeRecurring([], []),
    focus: [],
    coachFindings: [],
  };
}
