import type { ReportSummary } from "../reports/types";
import {
  COACH_MIN_TRADES,
  type CoachAnalysis,
  type CoachInsight,
  type CoachMetricsSnapshot,
  type CoachSeverity,
} from "./types";

/**
 * AI Coach insight generation (Phase 9, spec §28, §39).
 *
 * Deterministic, data-grounded coach — NO external LLM call.
 * Every insight is a rule applied to the trader's own stored
 * data, and every insight carries the exact numbers it was
 * computed from in its metrics snapshot. A rule that cannot be
 * supported by the data produces no insight at all.
 *
 * Evidence base: the weekly `ReportSummary` built by
 * `buildReportSummary` (Phase 8) plus the week's risk events
 * and current streak, supplied by the caller. Callers pass
 * real aggregates only.
 *
 * The `summary` of a stored insight is its title; the
 * recommendation and the evidence numbers live in the snapshot,
 * so the page can show "why" next to "what to do".
 */

export interface CoachEvidence {
  summary: ReportSummary;
  /** Risk events in the same week, by severity. */
  riskEvents: { critical: number; warning: number; positive: number };
  /** Current consecutive win/loss streak (positive = wins). */
  currentStreak: number;
}

function snapshot(
  rule: string,
  severity: CoachSeverity,
  recommendation: string,
  rest: Omit<CoachMetricsSnapshot, "rule" | "severity" | "recommendation"> = {},
): CoachMetricsSnapshot {
  return { rule, severity, recommendation, ...rest };
}

function money(n: number): string {
  return n.toFixed(2);
}

function worstRow(
  rows: readonly { name: string; trades: number; totalPnl: number }[],
  minTrades: number,
): { name: string; trades: number; totalPnl: number } | null {
  const eligible = rows.filter((r) => r.name !== "Not recorded" && r.trades >= minTrades);
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => a.totalPnl - b.totalPnl)[0] ?? null;
}

function bestRow(
  rows: readonly { name: string; trades: number; totalPnl: number }[],
  minTrades: number,
): { name: string; trades: number; totalPnl: number } | null {
  const eligible = rows.filter((r) => r.name !== "Not recorded" && r.trades >= minTrades);
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => b.totalPnl - a.totalPnl)[0] ?? null;
}

/**
 * Generate a week's coach insights from the evidence.
 *
 * With fewer than `COACH_MIN_TRADES` closed trades the coach
 * says so honestly (`insufficientData: true`) and generates
 * nothing — a 1-trade week cannot support a "best strategy" or
 * a "worst emotion" claim.
 */
export function generateCoachInsights(evidence: CoachEvidence): CoachAnalysis {
  const { summary: s } = evidence;
  const periodStart = s.periodStart;
  const periodEnd = s.periodEnd;
  if (s.tradesCount < COACH_MIN_TRADES) {
    return { periodStart, periodEnd, insufficientData: true, insights: [] };
  }

  const insights: CoachInsight[] = [];
  const base = {
    trades: s.tradesCount,
    wins: s.wins,
    losses: s.losses,
    totalPnl: s.totalPnl,
    winRate: s.winRate,
    profitFactor: s.profitFactor,
    avgR: s.avgR,
  };

  // --- Weekly performance overview (always, when there is data) ---
  const perfSeverity: CoachSeverity =
    s.totalPnl >= 0 ? "positive" : s.winRate !== null && s.winRate >= 50 ? "medium" : "high";
  insights.push({
    type: "weekly_performance",
    title:
      s.totalPnl >= 0
        ? `Profitable week: ${money(s.totalPnl)} across ${s.tradesCount} trades`
        : `Losing week: ${money(s.totalPnl)} across ${s.tradesCount} trades`,
    metricsSnapshot: snapshot(
      "weekly_performance",
      perfSeverity,
      s.totalPnl >= 0
        ? "Keep the routine that produced this week — review what you did differently before changing anything."
        : "Review your losing trades this week before trading again; the rules below name the biggest drags.",
      { ...base, currentStreak: evidence.currentStreak },
    ),
  });

  // --- Best / worst strategy (needs >= 2 trades on a strategy) ---
  const best = bestRow(s.byStrategy, 2);
  if (best && best.totalPnl > 0) {
    insights.push({
      type: "best_strategy",
      title: `Best strategy this week: ${best.name} (+${money(best.totalPnl)})`,
      metricsSnapshot: snapshot(
        "best_strategy",
        "positive",
        `Your edge this week was ${best.name}. Check what those ${best.trades} trades had in common and keep doing it.`,
        { ...base, strategy: best.name, trades: best.trades, totalPnl: best.totalPnl },
      ),
    });
  }
  const worst = worstRow(s.byStrategy, 2);
  if (worst && worst.totalPnl < 0) {
    insights.push({
      type: "worst_strategy",
      title: `Worst strategy this week: ${worst.name} (${money(worst.totalPnl)})`,
      metricsSnapshot: snapshot(
        "worst_strategy",
        "high",
        `Pause ${worst.name} until you have reviewed those ${worst.trades} losing trades — the setup, the entry and the exit.`,
        { ...base, strategy: worst.name, trades: worst.trades, totalPnl: worst.totalPnl },
      ),
    });
  }

  // --- Worst session (needs >= 2 trades in a session) ---
  const worstSession = worstRow(s.bySession, 2);
  if (worstSession && worstSession.totalPnl < 0) {
    insights.push({
      type: "worst_strategy",
      title: `Worst session this week: ${worstSession.name} (${money(worstSession.totalPnl)})`,
      metricsSnapshot: snapshot(
        "worst_session",
        "medium",
        `Your ${worstSession.name} trades lost ${money(Math.abs(worstSession.totalPnl))} across ${worstSession.trades} trades. Consider your no-trade conditions for that session.`,
        { ...base, session: worstSession.name, trades: worstSession.trades, totalPnl: worstSession.totalPnl },
      ),
    });
  }

  // --- Losing setup / repeated mistake ---
  if (s.mostFrequentLosingSetup && s.mostFrequentLosingSetup.losses >= 2) {
    const setup = s.mostFrequentLosingSetup;
    insights.push({
      type: "mistakes",
      title: `Most frequent losing setup: ${setup.name} (${setup.losses} losses)`,
      metricsSnapshot: snapshot(
        "losing_setup",
        "high",
        `Review your ${setup.name} losses before repeating the setup — what was the entry trigger on each one?`,
        { ...base, name: setup.name, occurrences: setup.losses },
      ),
    });
  }
  if (s.mostRepeatedMistake && s.mostRepeatedMistake.count >= 2) {
    const mistake = s.mostRepeatedMistake;
    insights.push({
      type: "mistakes",
      title: `Most repeated mistake: "${mistake.text}" (${mistake.count} times)`,
      metricsSnapshot: snapshot(
        "repeated_mistake",
        "high",
        `Pick one concrete fix for this mistake and write it into your trading plan before next week.`,
        { ...base, mistake: mistake.text, occurrences: mistake.count },
      ),
    });
  }

  // --- Psychology: worst emotion (needs >= 2 trades in that state) ---
  const worstEmotion = worstRow(s.byEmotion, 2);
  if (worstEmotion && worstEmotion.totalPnl < 0) {
    insights.push({
      type: "psychology",
      title: `Trades logged as ${worstEmotion.name} lost ${money(Math.abs(worstEmotion.totalPnl))}`,
      metricsSnapshot: snapshot(
        "worst_emotion",
        "high",
        `You lost money on ${worstEmotion.trades} trades logged as ${worstEmotion.name}. Use your plan's no-trade conditions for that state.`,
        { ...base, emotion: worstEmotion.name, trades: worstEmotion.trades, totalPnl: worstEmotion.totalPnl },
      ),
    });
  }

  // --- Discipline: journal completion and stop-loss rate ---
  if (s.journalCompletionPct !== null && s.journalCompletionPct < 80) {
    insights.push({
      type: "discipline",
      title: `Journal completion was ${s.journalCompletionPct}% this week`,
      metricsSnapshot: snapshot(
        "journal_completion",
        "medium",
        "Trades without a psychology record or lesson cannot be reviewed later — journal them the same day.",
        { ...base, journalCompletionPct: s.journalCompletionPct },
      ),
    });
  }
  if (s.disciplinePct !== null && s.disciplinePct < 100) {
    insights.push({
      type: "discipline",
      title: `Stop-loss set on ${s.disciplinePct}% of trades`,
      metricsSnapshot: snapshot(
        "stop_loss_rate",
        s.disciplinePct < 80 ? "high" : "medium",
        "Setting a stop-loss on every trade is the fastest discipline win in your own data.",
        { ...base, disciplinePct: s.disciplinePct },
      ),
    });
  }

  // --- Risk: breaches in the week ---
  const { critical, warning, positive } = evidence.riskEvents;
  if (critical > 0) {
    insights.push({
      type: "risk",
      title: `${critical} critical risk breach${critical === 1 ? "" : "es"} this week`,
      metricsSnapshot: snapshot(
        "critical_breach",
        "high",
        "A critical breach means a risk rule was broken. Read the breach on the Risk page and fix the rule or the behaviour before trading again.",
        { ...base, criticalRiskEvents: critical, warningRiskEvents: warning, positiveRiskEvents: positive },
      ),
    });
  } else if (warning > 0) {
    insights.push({
      type: "risk",
      title: `${warning} risk warning${warning === 1 ? "" : "s"} this week, no critical breach`,
      metricsSnapshot: snapshot(
        "risk_warnings",
        "medium",
        "Warnings are the early signal — check which rule fired on the Risk page and adjust before it becomes a breach.",
        { ...base, criticalRiskEvents: 0, warningRiskEvents: warning, positiveRiskEvents: positive },
      ),
    });
  } else if (s.disciplinePct === 100) {
    insights.push({
      type: "risk",
      title: "Clean risk week: no breaches, stop-loss on every trade",
      metricsSnapshot: snapshot(
        "clean_risk_week",
        "positive",
        "No risk rule fired this week. Keep the same risk routine next week.",
        { ...base, criticalRiskEvents: 0, warningRiskEvents: 0, positiveRiskEvents: positive },
      ),
    });
  }

  // --- Goals ---
  if (s.goalsTotal > 0) {
    if (s.goalsCompleted < s.goalsTotal) {
      insights.push({
        type: "goals",
        title: `Goals: ${s.goalsCompleted} of ${s.goalsTotal} completed this week`,
        metricsSnapshot: snapshot(
          "goals_incomplete",
          "medium",
          "Pick the one incomplete goal that matters most and put its next step on tomorrow's plan.",
          { ...base, goalsCompleted: s.goalsCompleted, goalsTotal: s.goalsTotal },
        ),
      });
    } else {
      insights.push({
        type: "goals",
        title: `All ${s.goalsTotal} goal${s.goalsTotal === 1 ? "" : "s"} completed this week`,
        metricsSnapshot: snapshot(
          "goals_complete",
          "positive",
          "Every goal for the week is done. Set the next one while the routine is working.",
          { ...base, goalsCompleted: s.goalsCompleted, goalsTotal: s.goalsTotal },
        ),
      });
    }
  }

  // --- Focus for next week: the single highest-priority problem ---
  const focus = insights
    .filter((i) => i.metricsSnapshot.severity === "high")
    .sort((a, b) => {
      // Losing setup / repeated mistake first, then worst strategy, then emotion, then risk.
      const rank = (rule: string) =>
        rule === "losing_setup" || rule === "repeated_mistake"
          ? 0
          : rule === "worst_strategy"
            ? 1
            : rule === "worst_emotion"
              ? 2
              : 3;
      return rank(a.metricsSnapshot.rule) - rank(b.metricsSnapshot.rule);
    })[0];
  if (focus) {
    insights.push({
      type: "focus_next_week",
      title: `Focus next week: ${focus.title}`,
      // Same evidence as the problem it focuses on, re-keyed so
      // the focus insight dedupes on its own rule.
      metricsSnapshot: { ...focus.metricsSnapshot, rule: "focus_next_week" },
    });
  }

  return { periodStart, periodEnd, insufficientData: false, insights };
}

/**
 * Future LLM extension point — NOT CONNECTED.
 *
 * This function only formats an already-generated, data-grounded
 * analysis into the text an LLM would receive. It makes NO
 * network call, needs NO API key, and is not called by any page
 * or action. If a future phase connects an LLM, it must take
 * this prompt (real numbers only) and must never be allowed to
 * invent statistics — the prompt states that explicitly. Do not
 * call this from a server action until that phase is built.
 */
export function buildLlmCoachPrompt(analysis: CoachAnalysis): string {
  const lines = analysis.insights.map((i) => {
    const s = i.metricsSnapshot;
    const evidence = [
      s.trades !== undefined ? `${s.trades} trades` : null,
      s.totalPnl !== undefined ? `total P&L ${money(s.totalPnl)}` : null,
      s.winRate !== undefined && s.winRate !== null ? `win rate ${s.winRate}%` : null,
      s.occurrences !== undefined ? `${s.occurrences} occurrences` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `- [${i.type}] ${i.title} (evidence: ${evidence || "see snapshot"}; recommendation: ${s.recommendation})`;
  });
  return [
    "You are the ITG TraderOS AI Coach. Analyse ONLY the trader's real data below.",
    "Do not invent any statistic, trade, or performance figure that is not listed here.",
    "If the data is insufficient for a point, say so.",
    `Week ${analysis.periodStart} to ${analysis.periodEnd}:`,
    ...lines,
  ].join("\n");
}
