import { describe, expect, it } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * Pre-trade gate service (Task 20).
 *
 * The contracts:
 * - The gate judges a CANDIDATE: the Task 19 plan engine
 *   runs on the candidate appended to its day lists, and
 *   the risk engine runs on createTradeCore's save-time
 *   inputs — so RULE VIOLATION predicts the save refusal.
 * - The gate is READ-ONLY: no inserts anywhere, ever.
 * - Precedence: the rules decide RULE VIOLATION, the plan
 *   decides CAUTION, and both judgements are carried side
 *   by side when their duplicated limits disagree.
 * - P&L and risk % are derived server-side from raw values
 *   (never accepted from the caller).
 */

import { evaluatePreTradeGateCore } from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-10-05T12:00:00Z");

function setup(tables: Record<string, Row[]>) {
  const full: Record<string, Row[]> = {
    profiles: [{ id: USER, trading_capital: 10000 }],
    trading_plans: [],
    risk_rules: [],
    trades: [],
    plan_events: [],
    risk_events: [],
    notifications: [],
    ...tables,
  };
  const { client, fake } = fakeSupabase(full);
  return { client, fake };
}

function planRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "plan-1",
    user_id: USER,
    name: "Test plan",
    markets: ["XAUUSD"],
    sessions: ["asia"],
    risk_per_trade_pct: 1,
    max_daily_loss: 200,
    max_daily_trades: 5,
    preferred_setup_ids: [],
    no_trade_conditions: null,
    psychology_rules: null,
    schedule: {},
    is_active: true,
    deleted_at: null,
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function rulesRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "rules-1",
    user_id: USER,
    plan_id: null,
    max_risk_per_trade_pct: 2,
    max_daily_loss: 500,
    max_trades_per_day: 5,
    max_consecutive_losses: 3,
    max_leverage: 10,
    is_active: true,
    deleted_at: null,
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function storedTrade(overrides: Partial<Row> & { id: string }): Row {
  return {
    user_id: USER,
    pair: "XAUUSD",
    session: "asia",
    setup_id: null,
    sl: null,
    entry_price: 2000,
    position_size: 1,
    pnl: 10,
    status: "closed",
    opened_at: "2026-10-05T08:00:00Z",
    closed_at: "2026-10-05T09:00:00Z",
    created_at: "2026-10-05T09:00:00Z",
    ...overrides,
  };
}

/** A clean on-plan candidate: XAUUSD/Asia, 0.1% risk, closed +10 on the day. */
function candidate(overrides: Record<string, unknown> = {}) {
  return {
    pair: "XAUUSD",
    direction: "long",
    entryPrice: 2000,
    exitPrice: 2010,
    tp: null,
    sl: 1990,
    positionSize: 1,
    strategyId: null,
    leverage: 1,
    fees: null,
    openedAt: "2026-10-05T09:00:00Z",
    closedAt: "2026-10-05T10:00:00Z",
    session: "asia",
    setupId: null,
    ...overrides,
  };
}

function verdict(
  gate: Extract<
    Awaited<ReturnType<typeof evaluatePreTradeGateCore>>,
    { ok: true }
  >["gate"],
  term: string,
) {
  const found = gate.planVerdicts.find((v) => v.term === term);
  if (!found) throw new Error(`no plan verdict for ${term}`);
  return found;
}

function check(
  gate: Extract<
    Awaited<ReturnType<typeof evaluatePreTradeGateCore>>,
    { ok: true }
  >["gate"],
  rule: string,
) {
  const found = gate.riskChecks.find((c) => c.rule === rule);
  if (!found) throw new Error(`no risk check for ${rule}`);
  return found;
}

describe("evaluatePreTradeGateCore", () => {
  it("READY for an on-plan candidate, and writes nothing anywhere", async () => {
    const { client, fake } = setup({
      trading_plans: [planRow()],
      risk_rules: [rulesRow()],
    });
    const result = await evaluatePreTradeGateCore(client, USER, candidate(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gate.level).toBe("ready");
    expect(result.gate.willBlockSave).toBe(false);
    expect(result.gate.planVerdicts).toHaveLength(6);
    expect(verdict(result.gate, "market").status).toBe("adhered");
    expect(verdict(result.gate, "risk_per_trade").status).toBe("adhered");
    expect(verdict(result.gate, "risk_per_trade").value).toBeCloseTo(0.1);
    // Read-only: the gate must not log events, notify, or journal.
    for (const table of ["trades", "plan_events", "risk_events", "notifications"]) {
      expect(fake.insertsFor(table)).toHaveLength(0);
    }
  });

  it("CAUTION (not a block) for a plan market breach", async () => {
    const { client } = setup({
      trading_plans: [planRow()],
      risk_rules: [rulesRow()],
    });
    const result = await evaluatePreTradeGateCore(
      client,
      USER,
      candidate({ pair: "GBPUSD" }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gate.level).toBe("caution");
    expect(result.gate.willBlockSave).toBe(false);
    expect(verdict(result.gate, "market").status).toBe("breached");
  });

  it("RULE VIOLATION for a breached rules CRITICAL, even when the plan adheres", async () => {
    const { client } = setup({
      trading_plans: [planRow()],
      risk_rules: [rulesRow()],
    });
    const result = await evaluatePreTradeGateCore(
      client,
      USER,
      candidate({ leverage: 50 }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gate.level).toBe("rule_violation");
    expect(result.gate.willBlockSave).toBe(true);
    expect(check(result.gate, "leverage_limit").breached).toBe(true);
    expect(verdict(result.gate, "market").status).toBe("adhered");
  });

  it("precedence: a plan limit stricter than the rules warns (CAUTION) while the rules pass", async () => {
    const { client } = setup({
      trading_plans: [planRow()], // risk 1%
      risk_rules: [rulesRow()], // risk 2%
    });
    // Risk amount |2000 − 1850| × 1 = 150 → 1.5% of 10000:
    // above the plan's 1%, within the rules' 2%.
    const result = await evaluatePreTradeGateCore(
      client,
      USER,
      candidate({ sl: 1850 }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gate.level).toBe("caution");
    expect(result.gate.willBlockSave).toBe(false);
    expect(verdict(result.gate, "risk_per_trade").status).toBe("breached");
    expect(verdict(result.gate, "risk_per_trade").value).toBeCloseTo(1.5);
    expect(verdict(result.gate, "risk_per_trade").limit).toBe(1);
    expect(check(result.gate, "risk_per_trade").breached).toBe(false);
    expect(check(result.gate, "risk_per_trade").limit).toBe(2);
  });

  it("precedence: a candidate loss that crosses the plan's daily loss but not the rules' stays CAUTION", async () => {
    const { client } = setup({
      trading_plans: [planRow()], // daily loss 200
      risk_rules: [rulesRow()], // daily loss 500
      trades: [storedTrade({ id: "t1", pnl: -190 })],
    });
    // Candidate closes −20 on the same day: cumulative −210
    // crosses the plan's 200 but not the rules' 500 (the
    // rules check sees only the stored −190, as a save would).
    const result = await evaluatePreTradeGateCore(
      client,
      USER,
      candidate({ exitPrice: 1990, positionSize: 2, sl: 1990 }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gate.level).toBe("caution");
    expect(verdict(result.gate, "daily_loss_limit").status).toBe("breached");
    expect(verdict(result.gate, "daily_loss_limit").value).toBe(-210);
    expect(check(result.gate, "daily_loss_limit").breached).toBe(false);
  });

  it("the candidate counts toward its opened day: 6th trade of a 5-trade plan day breaches", async () => {
    const stored = [1, 2, 3, 4, 5].map((n) =>
      storedTrade({
        id: `t${n}`,
        opened_at: `2026-10-05T0${n}:00:00Z`,
        closed_at: `2026-10-05T0${n}:30:00Z`,
      }),
    );
    const { client } = setup({
      trading_plans: [planRow()],
      risk_rules: [rulesRow()],
      trades: stored,
    });
    const result = await evaluatePreTradeGateCore(client, USER, candidate(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verdict(result.gate, "daily_trade_limit").status).toBe("breached");
    expect(verdict(result.gate, "daily_trade_limit").value).toBe(6);
    expect(result.gate.level).toBe("caution");
  });

  it("quick entry records no session: the session term is not_evaluable, not a breach, and the gate can still be READY", async () => {
    const { client } = setup({
      trading_plans: [planRow()],
      risk_rules: [rulesRow()],
    });
    const result = await evaluatePreTradeGateCore(
      client,
      USER,
      candidate({ session: null }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verdict(result.gate, "session").status).toBe("not_evaluable");
    expect(verdict(result.gate, "session").reason).toMatch(/No session was recorded/);
    expect(result.gate.level).toBe("ready");
    expect(result.gate.summary).toMatch(/could not be checked/);
  });

  it("no plan and no rules is READY with empty verdict lists", async () => {
    const { client } = setup({});
    const result = await evaluatePreTradeGateCore(client, USER, candidate(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gate.level).toBe("ready");
    expect(result.gate.planVerdicts).toHaveLength(0);
    expect(result.gate.riskChecks).toHaveLength(0);
    expect(result.gate.hasPlan).toBe(false);
    expect(result.gate.hasRules).toBe(false);
  });

  it("rejects invalid input without touching the database", async () => {
    const { client, fake } = setup({
      trading_plans: [planRow()],
      risk_rules: [rulesRow()],
    });
    const result = await evaluatePreTradeGateCore(
      client,
      USER,
      candidate({ entryPrice: -5 }),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
    expect(fake.insertsFor("trades")).toHaveLength(0);
  });
});
