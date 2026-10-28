import type { AnalyticTrade } from "@/lib/analytics/types";
import type { TradingSession } from "@/lib/trades/types";
import type {
  PlanVsActualRow,
  RiskCheck,
  RiskRules,
  TradingPlan,
} from "./types";

/**
 * Risk engine (Phase 5, spec §19–20). Pure functions only: no I/O,
 * no Supabase, no dates "now" hidden inside — callers pass the
 * trades and the day to evaluate.
 *
 * The engine WARNS. It never auto-executes or closes a real trade
 * (spec §41). Two severities stop a trade from being saved, and
 * only those two: the daily loss limit (CRITICAL) and leverage
 * above the configured maximum (CRITICAL). Everything else is a
 * WARNING: the trade is still journaled — a journal that refuses
 * to record a breach would hide the very behaviour it exists to
 * show — and the breach is logged to `risk_events`.
 *
 * A rule left unset (null) is skipped, never treated as zero.
 * All money is already decimal.js-computed P&L on the trade rows;
 * this file only compares numbers.
 */

/** Minimal trade shape the engine needs (closed trades carry pnl). */
export interface EngineTrade {
  pnl: number | null;
  status: string;
  closed_at: string | null;
  opened_at: string;
  sl: number | null;
  leverage: number;
  session: TradingSession | null;
  pair: string;
  strategyName: string | null;
}

export interface DayContext {
  /** Trades opened today (UTC), any status except cancelled/reversed. */
  tradesToday: number;
  /** P&L of trades closed today (UTC). Null when nothing closed today. */
  dayPnl: number | null;
  /** Current run of consecutive closed losses, most recent first. */
  consecutiveLosses: number;
}

/** UTC date (YYYY-MM-DD) of an ISO timestamp. */
export function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Closed trades, most recent close first. */
export function closedTradesNewestFirst(
  trades: readonly EngineTrade[],
): EngineTrade[] {
  return trades
    .filter((t) => t.status === "closed" && t.pnl !== null && t.closed_at !== null)
    .sort(
      (a, b) =>
        new Date(b.closed_at as string).getTime() -
        new Date(a.closed_at as string).getTime(),
    );
}

/** Run of consecutive closed losses, most recent first. 0 with no closed trades. */
export function countConsecutiveLosses(
  trades: readonly EngineTrade[],
): number {
  let count = 0;
  for (const t of closedTradesNewestFirst(trades)) {
    if ((t.pnl as number) < 0) count += 1;
    else break;
  }
  return count;
}

/**
 * Run of consecutive "disciplined" closed trades, most recent
 * first. A trade counts as disciplined when it had a stop-loss set
 * and its leverage was within the configured maximum (when set).
 * Risk-% is not part of this count: the engine cannot know the
 * trader's account size from a trade row alone.
 */
export function countDisciplinedStreak(
  trades: readonly EngineTrade[],
  rules: Pick<RiskRules, "max_leverage"> | null,
): number {
  let count = 0;
  for (const t of closedTradesNewestFirst(trades)) {
    const leverageOk =
      rules?.max_leverage === null ||
      rules?.max_leverage === undefined ||
      t.leverage <= (rules.max_leverage as number);
    if (t.sl !== null && leverageOk) count += 1;
    else break;
  }
  return count;
}

/** Day context for one UTC date from the trader's trades. */
export function buildDayContext(
  trades: readonly EngineTrade[],
  today: string,
): DayContext {
  const todays = trades.filter(
    (t) =>
      utcDate(t.opened_at) === today &&
      t.status !== "cancelled" &&
      t.status !== "reversed",
  );
  const closedToday = trades.filter(
    (t) =>
      t.status === "closed" &&
      t.pnl !== null &&
      t.closed_at !== null &&
      utcDate(t.closed_at) === today,
  );
  return {
    tradesToday: todays.length,
    dayPnl:
      closedToday.length === 0
        ? null
        : closedToday.reduce((sum, t) => sum + (t.pnl as number), 0),
    consecutiveLosses: countConsecutiveLosses(trades),
  };
}

export interface TradeCandidate {
  leverage: number;
  /** Risk of this trade as % of trading capital. Null when unknown. */
  riskPct: number | null;
}

/**
 * Evaluate one trade against the active rules. Returns one check
 * per configured rule (plus a positive check when the disciplined
 * streak hits a milestone). `breached` is true for WARNING and
 * CRITICAL checks; a check with `breached: false` means the rule
 * passed or was not set. Callers block the save only on
 * `severity === "critical" && breached`.
 */
export function evaluateTradeRisk(
  rules: RiskRules | null,
  candidate: TradeCandidate,
  day: DayContext,
  disciplinedStreak: number,
): RiskCheck[] {
  const checks: RiskCheck[] = [];
  if (!rules || !rules.is_active) return checks;

  if (rules.max_leverage !== null) {
    checks.push({
      rule: "leverage_limit",
      severity: "critical",
      breached: candidate.leverage > rules.max_leverage,
      message:
        candidate.leverage > rules.max_leverage
          ? `Leverage ${candidate.leverage}× exceeds your maximum of ${rules.max_leverage}×. This trade was not saved — lower the leverage or raise the limit in your risk rules.`
          : `Leverage ${candidate.leverage}× is within your maximum of ${rules.max_leverage}×.`,
      value: candidate.leverage,
      limit: rules.max_leverage,
    });
  }

  if (rules.max_daily_loss !== null && rules.max_daily_loss > 0) {
    const reached =
      day.dayPnl !== null && day.dayPnl <= -rules.max_daily_loss;
    checks.push({
      rule: "daily_loss_limit",
      severity: "critical",
      breached: reached,
      message: reached
        ? `You reached your daily loss limit. Today's P&L is ${day.dayPnl} against a limit of ${rules.max_daily_loss}. This trade was not saved — stop trading for today and review tomorrow.`
        : `Daily loss is within your limit of ${rules.max_daily_loss}.`,
      value: day.dayPnl,
      limit: rules.max_daily_loss,
    });
  }

  if (rules.max_trades_per_day !== null) {
    const exceeded = day.tradesToday >= rules.max_trades_per_day;
    checks.push({
      rule: "daily_trade_limit",
      severity: "warning",
      breached: exceeded,
      message: exceeded
        ? `You exceeded your planned daily trade limit. You have already made ${day.tradesToday} trades today against a limit of ${rules.max_trades_per_day}.`
        : `${day.tradesToday} of ${rules.max_trades_per_day} planned trades today.`,
      value: day.tradesToday,
      limit: rules.max_trades_per_day,
    });
  }

  if (
    rules.max_risk_per_trade_pct !== null &&
    candidate.riskPct !== null
  ) {
    checks.push({
      rule: "risk_per_trade",
      severity: "warning",
      breached: candidate.riskPct > rules.max_risk_per_trade_pct,
      message:
        candidate.riskPct > rules.max_risk_per_trade_pct
          ? `This trade risks ${candidate.riskPct.toFixed(2)}% of your capital, above your maximum of ${rules.max_risk_per_trade_pct}% per trade.`
          : `This trade risks ${candidate.riskPct.toFixed(2)}% of your capital, within your maximum of ${rules.max_risk_per_trade_pct}%.`,
      value: candidate.riskPct,
      limit: rules.max_risk_per_trade_pct,
    });
  }

  if (rules.max_consecutive_losses !== null) {
    const hit = day.consecutiveLosses >= rules.max_consecutive_losses;
    checks.push({
      rule: "consecutive_losses",
      severity: "warning",
      breached: hit,
      message: hit
        ? `You have ${day.consecutiveLosses} consecutive losses — your limit is ${rules.max_consecutive_losses}. Take a break before the next trade.`
        : `${day.consecutiveLosses} consecutive losses (limit ${rules.max_consecutive_losses}).`,
      value: day.consecutiveLosses,
      limit: rules.max_consecutive_losses,
    });
  }

  // Positive reinforcement (spec §19): milestones at 3, then every 5.
  const milestone = disciplinedStreak >= 3 && (disciplinedStreak === 3 || disciplinedStreak % 5 === 0);
  checks.push({
    rule: "positive_streak",
    severity: "positive",
    breached: milestone,
    message: milestone
      ? `You followed your risk plan for ${disciplinedStreak} consecutive trades.`
      : `${disciplinedStreak} consecutive risk-disciplined trades.`,
    value: disciplinedStreak,
    limit: null,
  });
  return checks;
}

/** True when any check is a breached CRITICAL — the only case that blocks a save. */
export function hasCriticalBreach(checks: readonly RiskCheck[]): boolean {
  return checks.some((c) => c.breached && c.severity === "critical");
}

/* ------------------------------------------------------- plan vs actual */

export interface PlanActualInput {
  plan: TradingPlan;
  /** Closed trades only (AnalyticTrade from lib/analytics). */
  trades: readonly AnalyticTrade[];
  /** Share of closed trades rated discipline "good" (0–100). Null with no data. */
  goodDisciplinePct: number | null;
  /** Strategy names actually used, from the trades. */
  strategiesUsed: string[];
  /** Setup names in the plan, resolved from preferred_setup_ids. */
  preferredSetupNames: string[];
}

const SESSION_LABELS: Record<TradingSession, string> = {
  asia: "Asia",
  london: "London",
  new_york: "New York",
  other: "Other",
};

/**
 * Compare actual behaviour against the trader's plan (spec §20).
 * Rows that cannot be measured from trades say so honestly
 * (`onTrack: null`) instead of guessing.
 */
export function evaluatePlanVsActual(input: PlanActualInput): PlanVsActualRow[] {
  const { plan, trades } = input;
  const rows: PlanVsActualRow[] = [];

  // Daily trades: worst single day vs the plan maximum.
  const perDay = new Map<string, number>();
  for (const t of trades) {
    const day = t.closedAt.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const maxInADay = perDay.size === 0 ? 0 : Math.max(...perDay.values());
  rows.push({
    label: "Trades per day",
    planned:
      plan.max_daily_trades !== null
        ? `At most ${plan.max_daily_trades} per day`
        : "No limit set",
    actual:
      trades.length === 0
        ? "No closed trades yet"
        : `Most in one day: ${maxInADay}`,
    onTrack:
      plan.max_daily_trades === null || trades.length === 0
        ? null
        : maxInADay <= plan.max_daily_trades,
  });

  // Sessions actually traded vs planned.
  const sessionsUsed = [...new Set(trades.map((t) => t.session).filter(Boolean))] as TradingSession[];
  rows.push({
    label: "Sessions",
    planned:
      plan.sessions.length === 0
        ? "No sessions set"
        : plan.sessions.map((s) => SESSION_LABELS[s]).join(", "),
    actual:
      sessionsUsed.length === 0
        ? "No closed trades yet"
        : sessionsUsed.map((s) => SESSION_LABELS[s]).join(", "),
    onTrack:
      plan.sessions.length === 0 || sessionsUsed.length === 0
        ? null
        : sessionsUsed.every((s) => plan.sessions.includes(s)),
  });

  // Markets (pairs) actually traded vs planned.
  const pairsUsed = [...new Set(trades.map((t) => t.pair))];
  rows.push({
    label: "Markets",
    planned:
      plan.markets.length === 0 ? "No markets set" : plan.markets.join(", "),
    actual:
      pairsUsed.length === 0 ? "No closed trades yet" : pairsUsed.join(", "),
    onTrack:
      plan.markets.length === 0 || pairsUsed.length === 0
        ? null
        : pairsUsed.every((p) =>
            plan.markets.some(
              (m) => m.toUpperCase() === p.toUpperCase(),
            ),
          ),
  });

  // Preferred setups vs strategies actually used.
  rows.push({
    label: "Preferred setups",
    planned:
      input.preferredSetupNames.length === 0
        ? "No preferred setups set"
        : input.preferredSetupNames.join(", "),
    actual:
      input.strategiesUsed.length === 0
        ? "No closed trades yet"
        : input.strategiesUsed.join(", "),
    onTrack: null, // Setups and strategies are different dimensions; not comparable.
  });

  // Risk per trade: plan % vs stop-loss discipline (a proxy — the
  // engine cannot know account size from trades alone).
  rows.push({
    label: "Risk per trade",
    planned:
      plan.risk_per_trade_pct !== null
        ? `At most ${plan.risk_per_trade_pct}% per trade`
        : "No limit set",
    actual:
      input.goodDisciplinePct === null
        ? "No psychology data yet"
        : `${input.goodDisciplinePct.toFixed(0)}% of trades rated good discipline`,
    onTrack: null,
  });

  // Psychology rules: text only — not measurable from trades.
  rows.push({
    label: "Psychology rules",
    planned: plan.psychology_rules ?? "No psychology rules set",
    actual: "Not measurable from trades — review your journal",
    onTrack: null,
  });

  // No-trade conditions: text only — not measurable from trades.
  rows.push({
    label: "No-trade conditions",
    planned: plan.no_trade_conditions ?? "No conditions set",
    actual: "Not measurable from trades — review your journal",
    onTrack: null,
  });

  return rows;
}
