/**
 * Pre-trade risk gate types (Task 20).
 *
 * The gate judges a CANDIDATE trade before it is saved and
 * returns one of three levels. It reuses the Task 19 plan
 * verdicts (lib/plan/types.ts) and the risk engine's checks
 * (lib/risk/types.ts) — it invents no second judgement
 * vocabulary. The gate is READ-ONLY: it writes no
 * plan_events, no risk_events, no notifications and no audit
 * rows. A preview must never pollute the history with a
 * trade that was never saved.
 */

import type { PlanTradeInput, PlanVerdict } from "@/lib/plan/types";
import type { RiskCheck } from "@/lib/risk/types";

/**
 * The gate's three levels (Task 20 spec):
 * - `ready` — no evaluated term breached.
 * - `caution` — at least one plan term breached, or at
 *   least one risk WARNING breached. The trade can still be
 *   saved: the gate never blocks on plan terms or warnings.
 * - `rule_violation` — at least one risk CRITICAL breached
 *   (leverage, daily loss, on the RULES' values). This is
 *   exactly the set createTradeCore refuses to save, so the
 *   level predicts the save outcome: a RULE VIOLATION gate
 *   means the save will be refused, not merely frowned at.
 *
 * An unevaluable term is never a pass: it keeps its
 * `not_evaluable` status and its reason in the rendered
 * rows, and the summary says so. The overall level, however,
 * is computed over EVALUATED terms only — a quick-entry
 * candidate never records a session or a setup, so those
 * two terms are unevaluable by construction, and demoting
 * every quick-entry gate to CAUTION on that ground alone
 * would train the trader to ignore CAUTION. The panel
 * therefore always lists the unchecked terms with their
 * reasons, and a READY summary reads "on every term that
 * could be checked" whenever coverage is partial.
 */
export type GateLevel = "ready" | "caution" | "rule_violation";

export interface GateResult {
  level: GateLevel;
  /** True exactly when the level is rule_violation — i.e. when createTradeCore will refuse the save. */
  willBlockSave: boolean;
  /** The six plan verdicts, in engine order — empty when the trader has no active plan. */
  planVerdicts: PlanVerdict[];
  /** The risk checks, in engine order — empty when no active rules exist. */
  riskChecks: RiskCheck[];
  hasPlan: boolean;
  hasRules: boolean;
  /** Trader-facing summary for the banner (real figures only, from the verdicts/checks). */
  summary: string;
}

/** The candidate trade the gate judges — the Task 19 PlanTradeInput shape, with a sentinel id. */
export type GateCandidate = PlanTradeInput;

/** One stored row opened on the candidate's opened day. */
export interface GateDayRow {
  id: string;
  openedAt: string;
  createdAt: string;
}

/** One stored row closed on the candidate's closed day (openedAt is irrelevant to close order). */
export interface GateClosedDayRow {
  id: string;
  pnl: number;
  closedAt: string;
  createdAt: string;
}
