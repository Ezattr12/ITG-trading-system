import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeTrades } from "@/lib/analytics/analytics";
import type { CoachChatAnswer, CoachChatEvidence } from "@/lib/coach/chat";
import {
  analyzeConditions,
  analyzeDrawdown,
  analyzeRiskBehavior,
} from "./analysis";
import {
  getIntelligenceData,
  getImprovementPlan,
  getMonthlyDigest,
} from "./queries";
import type { IntelTrade } from "./types";

/**
 * Coach answers for the Phase 23 intelligence intents.
 *
 * These builders are the composition the Phase 22 chat core
 * delegates to for its five new intents — they return the
 * exact structured shape the chat renders (FACTS /
 * INFERENCES / RECOMMENDATIONS + evidence) and every figure
 * comes from the intelligence analyses, which are themselves
 * built on the existing engines and `@itg/calc`. Like the
 * rest of the coach, they are read-only and speak only from
 * the caller's own rows.
 */

type ChatAnswerBody = Omit<CoachChatAnswer, "narration" | "narrationProvider">;

function money(n: number): string {
  return n.toFixed(2);
}

function pct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function evidenceFor(
  scope: string,
  trades: readonly IntelTrade[],
): CoachChatEvidence {
  const s = summarizeTrades(trades);
  const dates = trades.map((t) => t.closedAt.slice(0, 10)).sort();
  return {
    scope,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    tradesCount: s.tradeCount,
    wins: s.wins,
    losses: s.losses,
    totalPnl: s.totalPnl,
    winRate: s.winRate,
    profitFactor: s.profitFactor,
    expectancy: s.expectancy,
    avgR: s.avgR,
  };
}

function emptyEvidence(scope: string): CoachChatEvidence {
  return {
    scope,
    periodStart: null,
    periodEnd: null,
    tradesCount: null,
    wins: null,
    losses: null,
    totalPnl: null,
    winRate: null,
    profitFactor: null,
    expectancy: null,
    avgR: null,
  };
}

function insufficient(
  intent: ChatAnswerBody["intent"],
  scope: string,
  facts: string[],
): ChatAnswerBody {
  return {
    status: "insufficient_data",
    intent,
    facts,
    inferences: [],
    recommendations: [
      "Journal more closed trades, then ask again — the coach only speaks from your recorded data.",
    ],
    evidence: emptyEvidence(scope),
  };
}

/* --------------------------------------------------------------- drawdown */

export async function drawdownAnswer(
  supabase: SupabaseClient,
  userId: string,
): Promise<ChatAnswerBody> {
  const data = await getIntelligenceData(supabase, userId);
  const dd = analyzeDrawdown(data.trades);
  const scope = "All recorded closed trades";
  if (dd.status !== "ok") {
    return insufficient("drawdown_analysis", scope, [
      `You have ${data.trades.length} closed trade${data.trades.length === 1 ? "" : "s"} recorded in total.`,
      "A drawdown analysis needs at least 5 closed trades before the curve means anything.",
    ]);
  }
  const facts: string[] = [];
  if (dd.episode) {
    facts.push(
      `Your maximum drawdown is ${money(dd.maxDrawdown)}` +
        (dd.maxDrawdownPctOfPeak !== null
          ? ` (${pct(dd.maxDrawdownPctOfPeak)}% of the peak it fell from)`
          : "") +
        ` — equity peaked at ${money(dd.episode.peakEquity)} on ${dd.episode.peakDate} and troughed on ${dd.episode.troughDate}, ${dd.episode.daysToTrough} days later.`,
    );
    facts.push(
      dd.episode.recovered
        ? `That episode recovered on ${dd.episode.recoveryDate}.`
        : "That episode has not fully recovered — equity is still below that peak.",
    );
  } else {
    facts.push("Your equity curve has never fallen from a peak — there is no drawdown episode to measure yet.");
  }
  if (dd.longestUnderwater) {
    facts.push(
      `Your longest stretch below a peak lasted ${dd.longestUnderwater.trades} trades over ${dd.longestUnderwater.days} days (${dd.longestUnderwater.startDate} to ${dd.longestUnderwater.endDate}).`,
    );
  }
  facts.push(
    dd.atPeak
      ? "Your equity currently sits at its peak."
      : `Your equity currently sits ${money(dd.currentDrawdown)} below its peak.`,
  );
  const inferences: string[] = [];
  if (dd.episode && !dd.episode.recovered) {
    inferences.push(
      "Because the worst episode is unrecovered, part of the current gap is that episode — judge recent form by recent trades, not by the distance to the old peak alone.",
    );
  }
  if (dd.maxDrawdownPctOfPeak !== null && dd.maxDrawdownPctOfPeak >= 50) {
    inferences.push(
      "A fall of half or more of peak profit is the zone where traders most often change size or strategy mid-drawdown — the data says the process, not the moment, is what needs reviewing.",
    );
  }
  if (inferences.length === 0) {
    inferences.push(
      "The drawdown figures are measured from your stored P&L in close order; they describe what happened, not what the next stretch will do.",
    );
  }
  return {
    status: "ok",
    intent: "drawdown_analysis",
    facts,
    inferences,
    recommendations: [
      "Keep planned risk at or below your usual level until equity makes a new peak — recovering by sizing up is how drawdowns deepen.",
      "Review the trades inside the worst episode as a set: the shared pattern matters more than any single loss.",
    ],
    evidence: evidenceFor(scope, data.trades),
  };
}

/* ----------------------------------------------------------- risk behaviour */

export async function riskBehaviorAnswer(
  supabase: SupabaseClient,
  userId: string,
): Promise<ChatAnswerBody> {
  const data = await getIntelligenceData(supabase, userId);
  const today = new Date().toISOString().slice(0, 10);
  const risk = analyzeRiskBehavior(data.trades, {
    rules: data.rules,
    plan: data.plan,
    capital: data.capital,
    riskEvents: data.riskEvents,
    today,
  });
  const scope = "All recorded closed trades";
  if (risk.tradesCount === 0) {
    return insufficient("risk_behavior", scope, [
      "You have no closed trades recorded yet, so there is no risk behaviour to measure.",
    ]);
  }
  const facts: string[] = [];
  if (risk.distribution) {
    facts.push(
      `Across ${risk.distribution.count} trades with a stop-loss, your planned risk averaged ${money(risk.distribution.avg)} (median ${money(risk.distribution.median)}, largest ${money(risk.distribution.max)}).`,
    );
  } else {
    facts.push(
      "None of your closed trades has a stop-loss recorded, so planned risk cannot be measured — risk only exists in your data when a stop defines it.",
    );
  }
  if (risk.overLimitCount !== null && risk.riskLimitPct !== null) {
    facts.push(
      `${risk.overLimitCount} of ${risk.withRiskCount} trades planned more than your ${pct(risk.riskLimitPct)}% per-trade limit; ${risk.withinLimitPct !== null ? `${pct(risk.withinLimitPct)}%` : "the rest"} stayed inside it.`,
    );
  } else if (risk.riskLimitNote === "no_limit_configured") {
    facts.push(
      "No per-trade risk limit is configured in your risk rules or trading plan, so there is no limit to check your trades against yet.",
    );
  } else if (risk.riskLimitNote === "capital_missing" && risk.riskLimitPct !== null) {
    facts.push(
      `A per-trade limit of ${pct(risk.riskLimitPct)}% is configured, but no trading capital is recorded on your profile, so the limit cannot be measured in money yet.`,
    );
  }
  if (risk.dailyLossLimit !== null && risk.worstDay) {
    facts.push(
      `Your worst day closed at ${money(risk.worstDay.pnl)} (${risk.worstDay.date}); ${risk.dailyLossBreachDays ?? 0} day(s) went beyond your ${money(risk.dailyLossLimit)} daily loss limit.`,
    );
  }
  if (risk.trend) {
    facts.push(
      `Your average planned risk moved from ${money(risk.trend.priorAvg)} (earlier ${risk.trend.priorCount} trades) to ${money(risk.trend.recentAvg)} (recent ${risk.trend.recentCount} trades)` +
        (risk.trend.deltaPct !== null
          ? ` — a change of ${risk.trend.deltaPct >= 0 ? "+" : ""}${pct(risk.trend.deltaPct)}%.`
          : "."),
    );
  }
  if (risk.riskEvents.total > 0) {
    facts.push(
      `Your stored risk events total ${risk.riskEvents.total} (${risk.riskEvents.critical} critical, ${risk.riskEvents.warning} warnings), ${risk.riskEvents.last30Days} of them in the last 30 days.`,
    );
  }
  const inferences: string[] = [];
  if (risk.overLimitCount !== null && risk.overLimitCount > 0) {
    inferences.push(
      "The limit breaches are a sizing pattern, not bad luck — they happened at entry, before any outcome was known.",
    );
  }
  if (risk.trend && risk.trend.deltaPct !== null && risk.trend.deltaPct >= 20) {
    inferences.push(
      "Your planned risk has been drifting upward. Gradual size creep is usually invisible trade by trade; measured across the journal, it is clear.",
    );
  }
  if (inferences.length === 0) {
    inferences.push(
      "Nothing in the measured risk behaviour stands out as a breach pattern — the figures above are the whole picture.",
    );
  }
  const recommendations: string[] = [];
  if (risk.riskLimitNote === "no_limit_configured") {
    recommendations.push("Set a per-trade risk limit in your risk rules — measuring risk against nothing is how size quietly grows.");
  }
  if (risk.riskLimitNote === "capital_missing") {
    recommendations.push("Record your trading capital on your profile so your configured limits can be measured in money.");
  }
  if (risk.overLimitCount !== null && risk.overLimitCount > 0) {
    recommendations.push("Size each position from the stop-loss distance so the planned risk is at or under the limit before you enter.");
  }
  if (risk.withoutStopLossCount > 0) {
    recommendations.push(`Set a stop-loss on every trade — ${risk.withoutStopLossCount} closed trade(s) had none, so their risk was never planned.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Keep sizing the way you are — and re-check after your next run of trades.");
  }
  return {
    status: "ok",
    intent: "risk_behavior",
    facts,
    inferences,
    recommendations,
    evidence: evidenceFor(scope, data.trades),
  };
}

/* -------------------------------------------------------------- conditions */

export async function tradingConditionsAnswer(
  supabase: SupabaseClient,
  userId: string,
): Promise<ChatAnswerBody> {
  const data = await getIntelligenceData(supabase, userId);
  const conditions = analyzeConditions(data.trades);
  const scope = "All recorded closed trades, by condition";
  if (conditions.status !== "ok" || !conditions.best) {
    return insufficient("trading_conditions", scope, [
      `You have ${data.trades.length} closed trade${data.trades.length === 1 ? "" : "s"} recorded in total.`,
      "Naming a best or worst condition needs at least one session/direction, strategy/session or market-condition group with 3 or more trades.",
    ]);
  }
  const facts = conditions.rows.slice(0, 4).map((r, i) => {
    const tag = i === 0 ? "Best measured condition" : r === conditions.worst ? "Worst measured condition" : "Also measured";
    return `${tag}: ${r.label} — total P&L ${money(r.totalPnl)} across ${r.trades} trades${r.winRate !== null ? `, win rate ${pct(r.winRate)}%` : ""}${r.expectancy !== null ? `, expectancy ${money(r.expectancy)} per trade` : ""}.`;
  });
  return {
    status: "ok",
    intent: "trading_conditions",
    facts,
    inferences: [
      "These groups are small samples by construction — a condition leads because it leads in your recorded trades, which is a reason to review those trades, not proof the condition itself is an edge.",
    ],
    recommendations: [
      conditions.worst && conditions.worst.totalPnl < 0
        ? `Review your ${conditions.worst.label} trades as a set before repeating that condition.`
        : "Keep trading your measured conditions and let the samples grow before drawing firmer lines.",
    ],
    evidence: evidenceFor(scope, data.trades),
  };
}

/* ---------------------------------------------------------- improvement plan */

export async function improvementPlanAnswer(
  supabase: SupabaseClient,
  userId: string,
): Promise<ChatAnswerBody> {
  const plan = await getImprovementPlan(supabase, userId);
  const scope = "All recorded closed trades";
  if (plan.status !== "ok") {
    const data = await getIntelligenceData(supabase, userId);
    return insufficient("improvement_plan", scope, [
      `You have ${data.trades.length} closed trade${data.trades.length === 1 ? "" : "s"} recorded in total.`,
      "A personalized improvement plan needs at least 5 closed trades of evidence.",
    ]);
  }
  const data = await getIntelligenceData(supabase, userId);
  return {
    status: "ok",
    intent: "improvement_plan",
    facts: plan.actions.map((a) => a.evidence),
    inferences: [
      "The actions are ordered by impact on survival first — risk limits and drawdown before repetition, discipline, psychology and conditions — and each one rests on the evidence line above it.",
    ],
    recommendations: plan.actions.map((a) => `${a.title}. ${a.detail}`),
    evidence: evidenceFor(scope, data.trades),
  };
}

/* ------------------------------------------------------------ monthly review */

export async function monthlyReviewAnswer(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<ChatAnswerBody> {
  const digest = await getMonthlyDigest(supabase, userId, today);
  const scope = digest
    ? `Monthly review (${digest.periodStart} to ${digest.periodEnd})`
    : "Monthly review";
  if (!digest || digest.status !== "ok") {
    return insufficient("monthly_review", scope, [
      digest
        ? `No closed trades are recorded in ${digest.periodStart.slice(0, 7)} yet, so there is no monthly review to give.`
        : "This month's data could not be assembled from your journal.",
    ]);
  }
  const facts: string[] = [
    `In ${digest.periodStart.slice(0, 7)} you closed ${digest.tradesCount} trades for a total P&L of ${money(digest.totalPnl)}${digest.winRate !== null ? ` at a win rate of ${pct(digest.winRate)}%` : ""}.`,
  ];
  if (digest.drawdown.maxDrawdown > 0) {
    facts.push(
      `Within the month, the deepest fall from a peak was ${money(digest.drawdown.maxDrawdown)}${digest.drawdown.episode ? ` (peak ${digest.drawdown.episode.peakDate}, trough ${digest.drawdown.episode.troughDate})` : ""}.`,
    );
  }
  const topMistake = digest.recurring.mistakes[0];
  if (topMistake) {
    facts.push(
      `Most repeated mistake this month: "${topMistake.text}" — ${topMistake.count} times, linked trades totalled ${money(topMistake.totalPnlImpact)}.`,
    );
  }
  for (const finding of digest.coachFindings.slice(0, 3)) {
    facts.push(finding.title);
  }
  const recommendations = [
    ...digest.focus.map((a) => `${a.title}. ${a.detail}`),
    ...digest.recommendations,
  ].slice(0, 4);
  return {
    status: "ok",
    intent: "monthly_review",
    facts,
    inferences: [
      "This review is assembled from the month's stored trades, lessons and coach findings — the focus items are the month's measured drags in priority order, not generic advice.",
    ],
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ["Keep the routine that produced this month and review the next month the same way."],
    evidence: {
      scope,
      periodStart: digest.periodStart,
      periodEnd: digest.periodEnd,
      tradesCount: digest.tradesCount,
      wins: null,
      losses: null,
      totalPnl: digest.totalPnl,
      winRate: digest.winRate,
      profitFactor: null,
      expectancy: null,
      avgR: null,
    },
  };
}
