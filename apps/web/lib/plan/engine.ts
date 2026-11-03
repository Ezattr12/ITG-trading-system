import { utcDate } from "@/lib/risk/engine";
import type { TradingPlan } from "@/lib/risk/types";
import type { TradingSession } from "@/lib/trades/types";
import type {
  PlanDayContext,
  PlanTerm,
  PlanTradeInput,
  PlanVerdict,
} from "./types";

/**
 * Trading-plan enforcement engine (Task 19, spec §19–20).
 * Pure functions only: no I/O, no Supabase, no hidden "now" —
 * callers pass the trade, the plan and the day context.
 *
 * Enforcement is OBSERVATIONAL. The engine judges a SAVED
 * trade against the trader's own plan and returns one verdict
 * per term; breaches are logged to `plan_events` and notified
 * by the service layer. Nothing here blocks a save — the only
 * blocking checks in the product are the risk rules' two
 * CRITICALs (lib/risk/engine.ts), and whether the plan should
 * ever block is the Task 20 gate's decision, not this one's.
 *
 * Honesty rules, mirroring the risk engine:
 * - A plan field left unset (null, or an empty list) makes
 *   its term not_evaluable — never treated as zero, never
 *   treated as a breach.
 * - A trade field the trader never recorded (session and
 *   setup are only recorded by the advanced review; quick
 *   entry does not collect them) makes its term
 *   not_evaluable — absence of recording is a journaling
 *   gap, not a plan breach.
 * - A risk figure that cannot be derived (no stop-loss, or
 *   no trading capital on the profile) makes the risk term
 *   not_evaluable — the engine never guesses account size.
 * - Free-text plan fields (no_trade_conditions,
 *   psychology_rules, schedule notes) have no machine-
 *   readable counterpart on a trade and are never evaluated;
 *   evaluatePlanVsActual already presents them as
 *   "not measurable from trades".
 *
 * Day terms: a trade's verdict is `breached` whenever the
 * day aggregate INCLUDING that trade is past the plan's line
 * (the 6th trade of a 5-trade day breaches; a closed trade
 * that leaves the day beyond its loss limit breaches). The
 * stored EVENT, however, is created once per (user, day,
 * term) and is attributed to the trade that crossed the line,
 * because evaluation always happens in chronological order
 * (the save hook fires as each trade is journaled; the
 * background pass iterates in opened order) and the dedupe
 * key keeps the first — the crossing — event. See
 * docs/task-19-plan-enforcement.md.
 */

const SESSION_LABELS: Record<TradingSession, string> = {
  asia: "Asia",
  london: "London",
  new_york: "New York",
  other: "Other",
};

function notEvaluable(
  term: PlanTerm,
  reason: string,
): PlanVerdict {
  return { term, status: "not_evaluable", message: reason, value: null, limit: null, reason };
}

function money(n: number): string {
  return n.toFixed(2);
}

/** The UTC day a stored event for this term + trade refers to. */
export function planEventDay(term: PlanTerm, trade: PlanTradeInput): string {
  if (term === "daily_loss_limit" && trade.closedAt) {
    return utcDate(trade.closedAt);
  }
  return utcDate(trade.openedAt);
}

/**
 * Evaluate one saved trade against the active plan. Returns
 * one verdict per term (six, always in the same order) so
 * callers can log breaches, render the set, or — in Task 20 —
 * pre-compute a gate from the same shape. `dayContext` may be
 * null (e.g. a caller judging trade-level terms only); the
 * day terms are then not_evaluable.
 */
export function evaluateTradeAgainstPlan(
  trade: PlanTradeInput,
  plan: TradingPlan,
  dayContext: PlanDayContext | null,
): PlanVerdict[] {
  const verdicts: PlanVerdict[] = [];

  /* ------------------------------------------------ market */
  if (plan.markets.length === 0) {
    verdicts.push(
      notEvaluable("market", "Your plan does not list markets — every market is allowed."),
    );
  } else {
    const pair = trade.pair.trim().toUpperCase();
    const allowed = plan.markets.some(
      (m) => m.trim().toUpperCase() === pair,
    );
    verdicts.push({
      term: "market",
      status: allowed ? "adhered" : "breached",
      message: allowed
        ? `${trade.pair} is in your plan's markets (${plan.markets.join(", ")}).`
        : `Traded ${trade.pair}, which is not in your plan's markets (${plan.markets.join(", ")}).`,
      value: null,
      limit: null,
      reason: null,
    });
  }

  /* ----------------------------------------------- session */
  if (plan.sessions.length === 0) {
    verdicts.push(
      notEvaluable("session", "Your plan does not restrict sessions."),
    );
  } else if (trade.session === null) {
    verdicts.push(
      notEvaluable("session", "No session was recorded for this trade."),
    );
  } else {
    const allowed = plan.sessions.includes(trade.session);
    const planned = plan.sessions.map((s) => SESSION_LABELS[s]).join(", ");
    verdicts.push({
      term: "session",
      status: allowed ? "adhered" : "breached",
      message: allowed
        ? `Traded in the ${SESSION_LABELS[trade.session]} session, which your plan allows (${planned}).`
        : `Traded in the ${SESSION_LABELS[trade.session]} session; your plan trades ${planned}.`,
      value: null,
      limit: null,
      reason: null,
    });
  }

  /* ------------------------------------------------- setup */
  if (plan.preferred_setup_ids.length === 0) {
    verdicts.push(
      notEvaluable("setup", "Your plan does not name preferred setups."),
    );
  } else if (trade.setupId === null) {
    verdicts.push(
      notEvaluable("setup", "No setup was recorded for this trade."),
    );
  } else {
    const allowed = plan.preferred_setup_ids.includes(trade.setupId);
    verdicts.push({
      term: "setup",
      status: allowed ? "adhered" : "breached",
      message: allowed
        ? "The setup recorded for this trade is one of your plan's preferred setups."
        : "The setup recorded for this trade is not one of your plan's preferred setups.",
      value: null,
      limit: null,
      reason: null,
    });
  }

  /* ------------------------------------------ risk per trade */
  if (plan.risk_per_trade_pct === null) {
    verdicts.push(
      notEvaluable("risk_per_trade", "Your plan does not set a risk-per-trade limit."),
    );
  } else if (trade.riskPct === null) {
    verdicts.push(
      notEvaluable(
        "risk_per_trade",
        "This trade's risk could not be calculated (no stop-loss recorded, or no trading capital set).",
      ),
    );
  } else {
    const breached = trade.riskPct > plan.risk_per_trade_pct;
    verdicts.push({
      term: "risk_per_trade",
      status: breached ? "breached" : "adhered",
      message: breached
        ? `This trade risks ${trade.riskPct.toFixed(2)}% of your capital, above your plan's maximum of ${plan.risk_per_trade_pct}% per trade.`
        : `This trade risks ${trade.riskPct.toFixed(2)}% of your capital, within your plan's maximum of ${plan.risk_per_trade_pct}% per trade.`,
      value: trade.riskPct,
      limit: plan.risk_per_trade_pct,
      reason: null,
    });
  }

  /* ------------------------------------------- trades per day */
  if (plan.max_daily_trades === null) {
    verdicts.push(
      notEvaluable("daily_trade_limit", "Your plan does not limit trades per day."),
    );
  } else if (dayContext === null) {
    verdicts.push(
      notEvaluable("daily_trade_limit", "No day context was available for this trade."),
    );
  } else {
    const ordinal = dayContext.openedDayTradeIds.indexOf(trade.id) + 1;
    if (ordinal === 0) {
      verdicts.push(
        notEvaluable(
          "daily_trade_limit",
          "This trade is not part of its day's trade count.",
        ),
      );
    } else {
      const day = utcDate(trade.openedAt);
      const breached = ordinal > plan.max_daily_trades;
      verdicts.push({
        term: "daily_trade_limit",
        status: breached ? "breached" : "adhered",
        message: breached
          ? `Trade ${ordinal} on ${day} exceeds your plan's maximum of ${plan.max_daily_trades} trades per day.`
          : `${ordinal} of ${plan.max_daily_trades} planned trades on ${day}.`,
        value: ordinal,
        limit: plan.max_daily_trades,
        reason: null,
      });
    }
  }

  /* ---------------------------------------------- daily loss */
  if (plan.max_daily_loss === null || plan.max_daily_loss <= 0) {
    verdicts.push(
      notEvaluable("daily_loss_limit", "Your plan does not set a daily loss limit."),
    );
  } else if (trade.closedAt === null || trade.pnl === null) {
    verdicts.push(
      notEvaluable(
        "daily_loss_limit",
        "This trade has not closed, so it cannot move the day's realised P&L.",
      ),
    );
  } else if (dayContext === null) {
    verdicts.push(
      notEvaluable("daily_loss_limit", "No day context was available for this trade."),
    );
  } else {
    const idx = dayContext.closedDayTrades.findIndex((t) => t.id === trade.id);
    if (idx === -1) {
      verdicts.push(
        notEvaluable(
          "daily_loss_limit",
          "This trade is not part of its closing day's P&L.",
        ),
      );
    } else {
      let cumulative = 0;
      for (let i = 0; i <= idx; i += 1) {
        cumulative += dayContext.closedDayTrades[i].pnl;
      }
      const day = utcDate(trade.closedAt);
      const breached = cumulative <= -plan.max_daily_loss;
      verdicts.push({
        term: "daily_loss_limit",
        status: breached ? "breached" : "adhered",
        message: breached
          ? `The day's realised P&L reached ${money(cumulative)} on ${day}, beyond your plan's daily loss limit of ${money(plan.max_daily_loss)}.`
          : `The day's realised P&L is ${money(cumulative)} on ${day} — within your plan's daily loss limit of ${money(plan.max_daily_loss)}.`,
        value: cumulative,
        limit: plan.max_daily_loss,
        reason: null,
      });
    }
  }

  return verdicts;
}
