import { describe, expect, it } from "vitest";
import type { PlanTradeInput, PlanVerdict } from "@/lib/plan/types";
import type { RiskCheck } from "@/lib/risk/types";
import {
  buildCandidatePlanDayContext,
  composePreTradeGate,
} from "./engine";

/**
 * Pre-trade gate engine (Task 20) — pure-fixture tests.
 *
 * The contracts:
 * - The level is composed from Task 19 plan verdicts and
 *   risk-engine checks, never from a second judgement
 *   vocabulary: a breached CRITICAL is RULE VIOLATION, a
 *   breached plan term or WARNING is CAUTION, anything
 *   else is READY.
 * - A positive-streak milestone (breached=true, severity
 *   "positive") is NOT a breach for gate purposes.
 * - A not_evaluable term never moves the level — but it is
 *   never rendered as a pass either (the summary says how
 *   many terms could not be checked).
 * - Precedence: the rules decide RULE VIOLATION, the plan
 *   decides CAUTION, neither masks the other.
 * - The candidate day context is the stored day lists with
 *   the candidate appended, in deterministic order.
 */

function planVerdict(
  term: PlanVerdict["term"],
  status: PlanVerdict["status"],
): PlanVerdict {
  return {
    term,
    status,
    message: `${term} ${status}`,
    value: null,
    limit: null,
    reason: status === "not_evaluable" ? "not recorded" : null,
  };
}

function riskCheck(
  rule: RiskCheck["rule"],
  severity: RiskCheck["severity"],
  breached: boolean,
): RiskCheck {
  return { rule, severity, breached, message: `${rule} ${breached}`, value: null, limit: null };
}

const ALL_ADHERED = [
  "market",
  "session",
  "setup",
  "risk_per_trade",
  "daily_trade_limit",
  "daily_loss_limit",
].map((t) => planVerdict(t as PlanVerdict["term"], "adhered"));

const CANDIDATE: PlanTradeInput = {
  id: "__candidate__",
  pair: "XAUUSD",
  session: "asia",
  setupId: null,
  riskPct: 0.5,
  pnl: 100,
  status: "closed",
  openedAt: "2026-10-05T09:00:00Z",
  closedAt: "2026-10-05T10:00:00Z",
};

describe("composePreTradeGate — levels", () => {
  it("READY when every evaluated term adheres", () => {
    const gate = composePreTradeGate({
      planVerdicts: ALL_ADHERED,
      riskChecks: [riskCheck("leverage_limit", "critical", false)],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("ready");
    expect(gate.willBlockSave).toBe(false);
    expect(gate.summary).toMatch(/Ready/);
  });

  it("RULE VIOLATION on any breached CRITICAL, and only then does the save block", () => {
    const gate = composePreTradeGate({
      planVerdicts: ALL_ADHERED,
      riskChecks: [riskCheck("leverage_limit", "critical", true)],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("rule_violation");
    expect(gate.willBlockSave).toBe(true);
    expect(gate.summary).toMatch(/would refuse this save/);
  });

  it("CAUTION on a breached plan term alone — the save is NOT blocked", () => {
    const gate = composePreTradeGate({
      planVerdicts: [
        planVerdict("market", "breached"),
        ...ALL_ADHERED.slice(1),
      ],
      riskChecks: [riskCheck("leverage_limit", "critical", false)],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("caution");
    expect(gate.willBlockSave).toBe(false);
    expect(gate.summary).toMatch(/can still be saved/);
  });

  it("CAUTION on a breached risk WARNING alone", () => {
    const gate = composePreTradeGate({
      planVerdicts: ALL_ADHERED,
      riskChecks: [riskCheck("risk_per_trade", "warning", true)],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("caution");
    expect(gate.willBlockSave).toBe(false);
  });

  it("a positive-streak milestone is not a breach", () => {
    const gate = composePreTradeGate({
      planVerdicts: ALL_ADHERED,
      riskChecks: [riskCheck("positive_streak", "positive", true)],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("ready");
  });

  it("a not_evaluable term never moves the level, but the summary says it could not be checked", () => {
    const gate = composePreTradeGate({
      planVerdicts: [
        planVerdict("market", "adhered"),
        planVerdict("session", "not_evaluable"),
        planVerdict("setup", "not_evaluable"),
        planVerdict("risk_per_trade", "adhered"),
        planVerdict("daily_trade_limit", "adhered"),
        planVerdict("daily_loss_limit", "adhered"),
      ],
      riskChecks: [],
      hasPlan: true,
      hasRules: false,
    });
    expect(gate.level).toBe("ready");
    expect(gate.summary).toMatch(/2 terms could not be checked/);
    expect(gate.summary).toMatch(/not a pass/);
  });

  it("no plan and no rules is READY with nothing to check against", () => {
    const gate = composePreTradeGate({
      planVerdicts: [],
      riskChecks: [],
      hasPlan: false,
      hasRules: false,
    });
    expect(gate.level).toBe("ready");
    expect(gate.summary).toMatch(/nothing to check/);
  });
});

describe("composePreTradeGate — precedence (Decision 2)", () => {
  it("plan adherence never rescues a rules CRITICAL breach", () => {
    const gate = composePreTradeGate({
      planVerdicts: ALL_ADHERED,
      riskChecks: [riskCheck("daily_loss_limit", "critical", true)],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("rule_violation");
  });

  it("a plan breach with adhered rules is CAUTION, never RULE VIOLATION", () => {
    const gate = composePreTradeGate({
      planVerdicts: [
        planVerdict("market", "breached"),
        ...ALL_ADHERED.slice(1),
      ],
      riskChecks: [
        riskCheck("leverage_limit", "critical", false),
        riskCheck("daily_loss_limit", "critical", false),
      ],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("caution");
  });

  it("a CRITICAL breach outranks a plan breach in the level", () => {
    const gate = composePreTradeGate({
      planVerdicts: [
        planVerdict("market", "breached"),
        ...ALL_ADHERED.slice(1),
      ],
      riskChecks: [riskCheck("leverage_limit", "critical", true)],
      hasPlan: true,
      hasRules: true,
    });
    expect(gate.level).toBe("rule_violation");
    // …but the plan breach is still carried in the result, not masked.
    expect(gate.planVerdicts[0].status).toBe("breached");
  });
});

describe("buildCandidatePlanDayContext — candidate appended, in order", () => {
  it("places the candidate by opened order, so its ordinal counts stored trades opened earlier that day", () => {
    const ctx = buildCandidatePlanDayContext({
      storedOpened: [
        { id: "t1", openedAt: "2026-10-05T08:00:00Z", createdAt: "2026-10-05T08:00:00Z" },
        { id: "t2", openedAt: "2026-10-05T11:00:00Z", createdAt: "2026-10-05T11:00:00Z" },
      ],
      storedClosed: [],
      candidate: CANDIDATE,
      candidateCreatedAt: "2026-10-05T12:00:00Z",
    });
    // Candidate opened 09:00 sits between t1 (08:00) and t2 (11:00).
    expect(ctx.openedDayTradeIds).toEqual(["t1", "__candidate__", "t2"]);
  });

  it("includes the candidate's P&L in its closing day's cumulative list, in close order", () => {
    const ctx = buildCandidatePlanDayContext({
      storedOpened: [],
      storedClosed: [
        { id: "t1", createdAt: "2026-10-05T08:00:00Z", pnl: -150, closedAt: "2026-10-05T09:00:00Z" },
      ],
      candidate: CANDIDATE,
      candidateCreatedAt: "2026-10-05T12:00:00Z",
    });
    expect(ctx.closedDayTrades).toEqual([
      { id: "t1", pnl: -150 },
      { id: "__candidate__", pnl: 100 },
    ]);
  });

  it("an open candidate contributes nothing to the closed-day list", () => {
    const ctx = buildCandidatePlanDayContext({
      storedOpened: [],
      storedClosed: [],
      candidate: { ...CANDIDATE, pnl: null, status: "open", closedAt: null },
      candidateCreatedAt: "2026-10-05T12:00:00Z",
    });
    expect(ctx.closedDayTrades).toEqual([]);
  });
});
