import { utcDate } from "@/lib/risk/engine";
import type { PlanDayContext, PlanTerm, PlanTradeInput } from "@/lib/plan/types";
import type { RiskCheck } from "@/lib/risk/types";
import type {
  GateClosedDayRow,
  GateDayRow,
  GateLevel,
  GateResult,
} from "./types";

/**
 * Pre-trade gate engine (Task 20). Pure functions only: no
 * I/O, no Supabase, no hidden "now" — the service layer
 * builds the inputs, this module only composes them.
 *
 * The two Task 20 decisions (see docs/task-20-*.md for the
 * full audit evidence and reasoning):
 *
 * 1. NO plan term ever blocks. The journal's job is to
 *    record trades that happened (Task 7 doctrine: a
 *    journal that refuses a breach hides the behaviour it
 *    exists to show), and session/setup are unrecorded at
 *    quick entry, so a blocking plan gate could not even
 *    evaluate them pre-save. A plan breach is therefore at
 *    most CAUTION; the Task 19 observational logging still
 *    records it after the save.
 * 2. The RULES are the sole blocking authority, and the
 *    plan never overrides them. Where a field exists on
 *    both (risk per trade, daily loss, trades per day),
 *    BOTH judgements are shown, each labelled with its
 *    source and its own figure: the rules' value decides
 *    RULE VIOLATION vs not, the plan's value decides
 *    CAUTION vs not, and neither masks the other. A plan
 *    adherence never rescues a rules violation, and a
 *    stricter plan still warns (CAUTION) when the rules
 *    pass.
 */

/**
 * Build the Task 19 day context for a CANDIDATE trade: the
 * stored day rows plus the candidate, in the engine's
 * deterministic order (opened_at, created_at, id for the
 * opened list; closed_at, created_at, id for the closed
 * list). This is the Task 19 hand-off implemented
 * literally — append the candidate to the day lists and
 * re-run the same pure engine — not a second plan engine.
 * Cancelled/reversed rows must already be filtered out by
 * the caller (the same population buildPlanDayContext
 * uses); the candidate itself is always counted, with
 * `candidateCreatedAt` (the gate's evaluation time) as its
 * created_at for tie-breaking.
 */
export function buildCandidatePlanDayContext(input: {
  storedOpened: GateDayRow[];
  storedClosed: GateClosedDayRow[];
  candidate: PlanTradeInput;
  candidateCreatedAt: string;
}): PlanDayContext {
  const opened = [
    ...input.storedOpened,
    {
      id: input.candidate.id,
      openedAt: input.candidate.openedAt,
      createdAt: input.candidateCreatedAt,
    },
  ].sort(
    (a, b) =>
      a.openedAt.localeCompare(b.openedAt) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );

  // The closed list covers the candidate's closed day only
  // (the caller fetches that day's rows); an open candidate
  // contributes nothing, and the engine then reports the
  // daily-loss term not_evaluable, exactly as for a saved
  // open trade.
  let closed: { id: string; pnl: number }[] = [];
  if (input.candidate.closedAt !== null && input.candidate.pnl !== null) {
    closed = [
      ...input.storedClosed.map((r) => ({
        id: r.id,
        pnl: r.pnl,
        closedAt: r.closedAt,
        createdAt: r.createdAt,
      })),
      {
        id: input.candidate.id,
        pnl: input.candidate.pnl,
        closedAt: input.candidate.closedAt,
        createdAt: input.candidateCreatedAt,
      },
    ]
      .sort(
        (a, b) =>
          a.closedAt.localeCompare(b.closedAt) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      )
      .map((r) => ({ id: r.id, pnl: r.pnl }));
  }

  return {
    openedDayTradeIds: opened.map((r) => r.id),
    closedDayTrades: closed,
  };
}

/** The UTC day a plan term refers to (opened day, except the loss term's closed day). */
export function gatePlanEventDay(term: PlanTerm, trade: PlanTradeInput): string {
  return term === "daily_loss_limit" && trade.closedAt
    ? utcDate(trade.closedAt)
    : utcDate(trade.openedAt);
}

function levelSummary(
  level: GateLevel,
  planBreaches: number,
  warningBreaches: number,
  criticalBreaches: number,
  unevaluable: number,
  hasPlan: boolean,
  hasRules: boolean,
): string {
  if (!hasPlan && !hasRules) {
    return "No trading plan or risk rules are set, so there is nothing to check this trade against.";
  }
  const unchecked =
    unevaluable > 0
      ? ` ${unevaluable} term${unevaluable === 1 ? "" : "s"} could not be checked — see below; an unchecked term is not a pass.`
      : "";
  if (level === "rule_violation") {
    return `Rule violation: ${criticalBreaches} risk rule${criticalBreaches === 1 ? "" : "s"} that would refuse this save ${criticalBreaches === 1 ? "is" : "are"} breached.${unchecked}`;
  }
  if (level === "caution") {
    const parts: string[] = [];
    if (planBreaches > 0)
      parts.push(`${planBreaches} plan term${planBreaches === 1 ? "" : "s"}`);
    if (warningBreaches > 0)
      parts.push(`${warningBreaches} risk warning${warningBreaches === 1 ? "" : "s"}`);
    return `Caution: ${parts.join(" and ")} breached. This trade can still be saved — the gate never blocks on plan terms or warnings.${unchecked}`;
  }
  return `Ready — within your plan and rules on every term that could be checked.${unchecked}`;
}

/**
 * Compose the gate level from Task 19 plan verdicts and
 * risk-engine checks. A risk check with severity
 * "positive" is a milestone, not a breach, even though its
 * `breached` flag is true — counting it as a breach would
 * turn disciplined streaks into CAUTION.
 */
export function composePreTradeGate(input: {
  planVerdicts: GateResult["planVerdicts"];
  riskChecks: RiskCheck[];
  hasPlan: boolean;
  hasRules: boolean;
}): GateResult {
  const critical = input.riskChecks.filter(
    (c) => c.breached && c.severity === "critical",
  );
  const warnings = input.riskChecks.filter(
    (c) => c.breached && c.severity === "warning",
  );
  const planBreaches = input.planVerdicts.filter(
    (v) => v.status === "breached",
  );
  const unevaluable = input.planVerdicts.filter(
    (v) => v.status === "not_evaluable",
  ).length;
  // Risk checks for unset rules are absent, not
  // not_evaluable — the engine only emits a check for a
  // configured rule — so unevaluable counts plan terms only.
  const level: GateLevel =
    critical.length > 0
      ? "rule_violation"
      : planBreaches.length > 0 || warnings.length > 0
        ? "caution"
        : "ready";
  return {
    level,
    willBlockSave: level === "rule_violation",
    planVerdicts: input.planVerdicts,
    riskChecks: input.riskChecks,
    hasPlan: input.hasPlan,
    hasRules: input.hasRules,
    summary: levelSummary(
      level,
      planBreaches.length,
      warnings.length,
      critical.length,
      unevaluable,
      input.hasPlan,
      input.hasRules,
    ),
  };
}
