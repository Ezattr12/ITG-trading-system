import { summarizeTrades } from "@/lib/analytics/analytics";
import {
  analyzeRecurring,
  CONDITION_LABELS,
  CONFIDENCE_BANDS,
  GROUP_MIN_TRADES,
  groupBy,
  groupStat,
  INTEL_MIN_TRADES,
  MATERIAL_WIN_RATE_GAP,
  SESSION_LABELS,
} from "./analysis";
import type {
  GroupStat,
  IntelLesson,
  IntelTrade,
  PatternAnalysis,
  PatternKind,
  TradingPattern,
} from "./types";

/**
 * Personal Trading Pattern Engine (Task 18).
 *
 * ONE pattern layer over the trader's own closed trades,
 * built on the intelligence grouping primitives
 * (`groupBy` / `groupStat` in `analysis.ts`, themselves built
 * on `summarizeTrades` and `@itg/calc`). It detects the
 * groups that genuinely stand out from the trader's overall
 * baseline and reports each with its evidence — sample size,
 * win rate versus baseline, total P&L — under one uniform
 * materiality standard. It computes from stored trades on
 * read; nothing derived is persisted (ai_insights remains
 * the only snapshot store).
 *
 * The standard (the intelligence conventions, applied
 * uniformly — see docs/task-18-pattern-engine.md):
 * - The account needs ≥ INTEL_MIN_TRADES (5) closed trades
 *   before any pattern is claimed.
 * - A group needs ≥ GROUP_MIN_TRADES (3) closed trades.
 * - A group is significant when its win rate beats or
 *   trails the trader's overall win rate by at least
 *   MATERIAL_WIN_RATE_GAP (20) points, OR when its total
 *   P&L accounts for at least PATTERN_DOMINANCE_SHARE of
 *   the gross P&L movement (Σ|P&L|) across all closed
 *   trades.
 * - A group covering every closed trade is the baseline
 *   itself, never a pattern.
 * - Groups form over RECORDED values only: a trade with no
 *   strategy/session/setup recorded joins no group on that
 *   dimension. Unrecorded coverage is a journaling gap,
 *   measured by the discipline analysis — not a pattern.
 * - The stop-loss split is a two-way discipline split, so
 *   it qualifies on the win-rate gap only: in a two-way
 *   split, one side holding most of the P&L is arithmetic,
 *   not a pattern.
 * - Repeated mistakes follow the established recurrence
 *   convention (analyzeRecurring: the same lesson text
 *   recorded ≥2 times), not the group-of-3 rule.
 *
 * Every statement is about recorded history. Nothing here
 * predicts a market, a price, or a future outcome.
 */

/** Minimum |group P&L| share of gross P&L movement for a dominance pattern. */
export const PATTERN_DOMINANCE_SHARE = 0.5;

interface Baseline {
  trades: number;
  wins: number;
  winRate: number | null;
  totalPnl: number;
  grossPnl: number;
}

function fromGroup(
  kind: PatternKind,
  g: GroupStat,
  baseline: Baseline,
  allowDominance: boolean,
): TradingPattern | null {
  if (g.trades < GROUP_MIN_TRADES) return null;
  // The whole population is the baseline, not a pattern.
  if (g.trades >= baseline.trades) return null;
  const gap =
    g.winRate !== null && baseline.winRate !== null
      ? g.winRate - baseline.winRate
      : null;
  const share =
    baseline.grossPnl > 0 ? Math.abs(g.totalPnl) / baseline.grossPnl : null;
  const gapHit = gap !== null && Math.abs(gap) >= MATERIAL_WIN_RATE_GAP;
  const dominanceHit =
    allowDominance && share !== null && share >= PATTERN_DOMINANCE_SHARE && g.totalPnl !== 0;
  if (!gapHit && !dominanceHit) return null;
  return {
    kind,
    key: g.key,
    label: g.label,
    // When both tests pass, the win-rate gap is the headline:
    // it is the stronger claim (a rate, not just a share).
    direction: gapHit ? (gap > 0 ? "edge" : "drag") : g.totalPnl > 0 ? "edge" : "drag",
    basis: gapHit ? "win_rate_gap" : "pnl_dominance",
    trades: g.trades,
    wins: g.wins,
    losses: g.losses,
    winRate: g.winRate,
    baselineWinRate: baseline.winRate,
    winRateGap: gapHit ? gap : null,
    totalPnl: g.totalPnl,
    avgPnl: g.trades > 0 ? g.totalPnl / g.trades : null,
    pnlShare: share,
    occurrences: null,
  };
}

/** Display-ordering strength only — never an evidence claim. */
function strength(p: TradingPattern): number {
  if (p.winRateGap !== null) return Math.abs(p.winRateGap);
  if (p.pnlShare !== null) return p.pnlShare * 100;
  return (p.occurrences ?? 0) * 5;
}

/**
 * Detect the trader's significant recurring patterns over
 * all of their closed trades (the caller supplies closed
 * trades only — `getIntelligenceData` filters
 * `status = 'closed'`, so reversed and cancelled trades
 * never reach this function).
 */
export function analyzePatterns(
  trades: readonly IntelTrade[],
  lessons: readonly IntelLesson[],
): PatternAnalysis {
  const s = summarizeTrades(trades);
  const baseline: Baseline = {
    trades: s.tradeCount,
    wins: s.wins,
    winRate: s.winRate,
    totalPnl: s.totalPnl,
    grossPnl: trades.reduce((sum, t) => sum + Math.abs(t.pnl), 0),
  };
  const base = {
    tradesCount: trades.length,
    baseline: {
      trades: baseline.trades,
      wins: baseline.wins,
      winRate: baseline.winRate,
      totalPnl: baseline.totalPnl,
    },
  };
  if (trades.length < INTEL_MIN_TRADES) {
    return { status: "insufficient_data", ...base, patterns: [] };
  }

  const patterns: TradingPattern[] = [];
  const collect = (kind: PatternKind, groups: GroupStat[], allowDominance = true) => {
    for (const g of groups) {
      const p = fromGroup(kind, g, baseline, allowDominance);
      if (p) patterns.push(p);
    }
  };

  collect(
    "strategy",
    groupBy(trades, (t) => t.strategyName, (key) => key),
  );
  collect(
    "session",
    groupBy(trades, (t) => t.session, (key) => SESSION_LABELS[key] ?? key),
  );
  collect(
    "direction",
    groupBy(trades, (t) => t.direction, (key) => (key === "long" ? "Long" : "Short")),
  );
  collect(
    "pair",
    groupBy(trades, (t) => t.pair, (key) => key),
  );
  collect(
    "setup",
    groupBy(trades, (t) => t.setupName, (key) => key),
  );
  collect(
    "market_condition",
    groupBy(trades, (t) => t.marketCondition, (key) => CONDITION_LABELS[key] ?? key),
  );
  collect(
    "emotion",
    groupBy(trades, (t) => t.emotion, (key) => key),
  );
  collect(
    "confidence",
    CONFIDENCE_BANDS.map((band) =>
      groupStat(
        band.key,
        band.label,
        trades.filter((t) => t.confidence !== null && band.test(t.confidence)),
      ),
    ).filter((g) => g.trades > 0),
  );
  collect(
    "session_direction",
    groupBy(
      trades,
      (t) => (t.session ? `${t.session}|${t.direction}` : null),
      (key) => {
        const [session, direction] = key.split("|");
        return `${SESSION_LABELS[session] ?? session} · ${direction === "long" ? "Long" : "Short"}`;
      },
    ),
  );
  collect(
    "strategy_session",
    groupBy(
      trades,
      (t) => (t.strategyName && t.session ? `${t.strategyName}|${t.session}` : null),
      (key) => {
        const [strategy, session] = key.split("|");
        return `${strategy} · ${SESSION_LABELS[session] ?? session}`;
      },
    ),
  );
  // Two-way discipline split: win-rate gap only (see header).
  collect(
    "stop_loss",
    [
      groupStat("with_sl", "Stop-loss set", trades.filter((t) => t.stopLossSet)),
      groupStat("without_sl", "No stop-loss", trades.filter((t) => !t.stopLossSet)),
    ],
    false,
  );

  // Repeated mistakes: the recurrence convention (≥2 records
  // of the same lesson text), via the one recurrence analysis.
  for (const m of analyzeRecurring(trades, lessons).mistakes) {
    patterns.push({
      kind: "repeated_mistake",
      key: m.text,
      label: m.text,
      direction: "recurring",
      basis: "recurrence",
      trades: m.tradesAffected,
      wins: m.wins,
      losses: m.losingTrades,
      winRate: m.tradesAffected > 0 ? (m.wins / m.tradesAffected) * 100 : null,
      baselineWinRate: baseline.winRate,
      winRateGap: null,
      totalPnl: m.totalPnlImpact,
      avgPnl: m.tradesAffected > 0 ? m.totalPnlImpact / m.tradesAffected : null,
      pnlShare:
        baseline.grossPnl > 0 ? Math.abs(m.totalPnlImpact) / baseline.grossPnl : null,
      occurrences: m.count,
    });
  }

  patterns.sort(
    (a, b) => strength(b) - strength(a) || Math.abs(b.totalPnl) - Math.abs(a.totalPnl),
  );
  return { status: "ok", ...base, patterns };
}
