import { describe, expect, it } from "vitest";
import type { TradingPlan } from "@/lib/risk/types";
import { evaluateTradeAgainstPlan } from "./engine";
import type { PlanDayContext, PlanTradeInput, PlanVerdict } from "./types";

/**
 * Plan enforcement engine (Task 19) — pure-fixture tests.
 *
 * The contract: every term is judged only when BOTH sides
 * honestly support it (a set plan field AND a recorded trade
 * field / derivable figure); anything else is not_evaluable
 * with a reason — never a breach, never a guess. Day terms
 * breach only on aggregates that include the judged trade.
 */

const PLAN: TradingPlan = {
  id: "plan-1",
  user_id: "user-1",
  name: "Test plan",
  markets: ["XAUUSD"],
  sessions: ["asia"],
  risk_per_trade_pct: 1,
  max_daily_loss: 200,
  max_daily_trades: 5,
  preferred_setup_ids: ["setup-1"],
  no_trade_conditions: null,
  psychology_rules: null,
  schedule: {},
  is_active: true,
};

const TRADE: PlanTradeInput = {
  id: "t1",
  pair: "XAUUSD",
  session: "asia",
  setupId: "setup-1",
  riskPct: 0.5,
  pnl: 100,
  status: "closed",
  openedAt: "2026-10-05T09:00:00Z",
  closedAt: "2026-10-05T10:00:00Z",
};

const CONTEXT: PlanDayContext = {
  openedDayTradeIds: ["t1"],
  closedDayTrades: [{ id: "t1", pnl: 100 }],
};

function verdict(
  trade: Partial<PlanTradeInput>,
  plan: Partial<TradingPlan>,
  context: PlanDayContext | null,
  term: PlanVerdict["term"],
): PlanVerdict {
  const all = evaluateTradeAgainstPlan(
    { ...TRADE, ...trade },
    { ...PLAN, ...plan },
    context,
  );
  const found = all.find((v) => v.term === term);
  if (!found) throw new Error(`no verdict for ${term}`);
  return found;
}

describe("evaluateTradeAgainstPlan — shape", () => {
  it("always returns the six terms in a fixed order", () => {
    const terms = evaluateTradeAgainstPlan(TRADE, PLAN, CONTEXT).map(
      (v) => v.term,
    );
    expect(terms).toEqual([
      "market",
      "session",
      "setup",
      "risk_per_trade",
      "daily_trade_limit",
      "daily_loss_limit",
    ]);
  });

  it("a fully on-plan trade adheres on every evaluable term", () => {
    const all = evaluateTradeAgainstPlan(TRADE, PLAN, CONTEXT);
    expect(all.every((v) => v.status === "adhered")).toBe(true);
  });
});

describe("market term", () => {
  it("adheres for a listed market, breaches for an unlisted one", () => {
    expect(verdict({}, {}, CONTEXT, "market").status).toBe("adhered");
    expect(
      verdict({ pair: "GBPUSD" }, {}, CONTEXT, "market").status,
    ).toBe("breached");
  });

  it("matches case-insensitively, like evaluatePlanVsActual", () => {
    expect(
      verdict({ pair: "xauusd" }, {}, CONTEXT, "market").status,
    ).toBe("adhered");
  });

  it("an empty markets list is unrestricted — not_evaluable, never a breach", () => {
    const v = verdict({ pair: "GBPUSD" }, { markets: [] }, CONTEXT, "market");
    expect(v.status).toBe("not_evaluable");
    expect(v.reason).toMatch(/does not list markets/);
  });
});

describe("session term", () => {
  it("adheres for a planned session, breaches for an unplanned one", () => {
    expect(verdict({}, {}, CONTEXT, "session").status).toBe("adhered");
    expect(
      verdict({ session: "london" }, {}, CONTEXT, "session").status,
    ).toBe("breached");
  });

  it("an unrecorded session is not_evaluable — a journaling gap, not a breach", () => {
    const v = verdict({ session: null }, {}, CONTEXT, "session");
    expect(v.status).toBe("not_evaluable");
    expect(v.reason).toMatch(/No session was recorded/);
  });

  it("a plan with no sessions restricts nothing", () => {
    expect(
      verdict({ session: "london" }, { sessions: [] }, CONTEXT, "session")
        .status,
    ).toBe("not_evaluable");
  });
});

describe("setup term", () => {
  it("adheres for a preferred setup, breaches for a non-preferred one", () => {
    expect(verdict({}, {}, CONTEXT, "setup").status).toBe("adhered");
    expect(
      verdict({ setupId: "setup-2" }, {}, CONTEXT, "setup").status,
    ).toBe("breached");
  });

  it("an unrecorded setup is not_evaluable, not a breach", () => {
    expect(verdict({ setupId: null }, {}, CONTEXT, "setup").status).toBe(
      "not_evaluable",
    );
  });

  it("a plan naming no preferred setups makes the term not_evaluable", () => {
    expect(
      verdict({}, { preferred_setup_ids: [] }, CONTEXT, "setup").status,
    ).toBe("not_evaluable");
  });
});

describe("risk_per_trade term", () => {
  it("adheres at or below the plan %, breaches above it", () => {
    expect(verdict({ riskPct: 1 }, {}, CONTEXT, "risk_per_trade").status).toBe(
      "adhered",
    );
    const over = verdict({ riskPct: 2.5 }, {}, CONTEXT, "risk_per_trade");
    expect(over.status).toBe("breached");
    expect(over.value).toBe(2.5);
    expect(over.limit).toBe(1);
  });

  it("an underivable risk figure is not_evaluable (no SL / no capital)", () => {
    const v = verdict({ riskPct: null }, {}, CONTEXT, "risk_per_trade");
    expect(v.status).toBe("not_evaluable");
    expect(v.reason).toMatch(/could not be calculated/);
  });

  it("an unset plan % is not_evaluable", () => {
    expect(
      verdict({}, { risk_per_trade_pct: null }, CONTEXT, "risk_per_trade")
        .status,
    ).toBe("not_evaluable");
  });
});

describe("daily_trade_limit term", () => {
  const sixTrades: PlanDayContext = {
    openedDayTradeIds: ["a", "b", "c", "d", "e", "t1", "g"],
    closedDayTrades: [{ id: "t1", pnl: 100 }],
  };

  it("adheres at the limit (5th of 5)", () => {
    const ctx: PlanDayContext = {
      openedDayTradeIds: ["a", "b", "c", "d", "t1"],
      closedDayTrades: [{ id: "t1", pnl: 100 }],
    };
    const v = verdict({}, {}, ctx, "daily_trade_limit");
    expect(v.status).toBe("adhered");
    expect(v.value).toBe(5);
  });

  it("the crossing trade (6th of 5) breaches", () => {
    const v = verdict({}, {}, sixTrades, "daily_trade_limit");
    expect(v.status).toBe("breached");
    expect(v.value).toBe(6);
    expect(v.limit).toBe(5);
  });

  it("a trade beyond the crossing also breaches (the day is over the limit)", () => {
    const v = verdict(
      { id: "g" },
      {},
      sixTrades,
      "daily_trade_limit",
    );
    expect(v.status).toBe("breached");
    expect(v.value).toBe(7);
  });

  it("without a day context the term is not_evaluable", () => {
    expect(verdict({}, {}, null, "daily_trade_limit").status).toBe(
      "not_evaluable",
    );
  });

  it("an unset plan limit is not_evaluable", () => {
    expect(
      verdict({}, { max_daily_trades: null }, CONTEXT, "daily_trade_limit")
        .status,
    ).toBe("not_evaluable");
  });
});

describe("daily_loss_limit term", () => {
  it("adheres while the day is within the limit", () => {
    expect(verdict({}, {}, CONTEXT, "daily_loss_limit").status).toBe(
      "adhered",
    );
  });

  it("the trade whose close crosses the line breaches", () => {
    const ctx: PlanDayContext = {
      openedDayTradeIds: ["a", "t1"],
      closedDayTrades: [
        { id: "a", pnl: -100 },
        { id: "t1", pnl: -150 },
      ],
    };
    const v = verdict({ pnl: -150 }, {}, ctx, "daily_loss_limit");
    expect(v.status).toBe("breached");
    expect(v.value).toBe(-250);
    expect(v.limit).toBe(200);
  });

  it("an earlier trade that stayed within the line adheres", () => {
    const ctx: PlanDayContext = {
      openedDayTradeIds: ["t1", "a"],
      closedDayTrades: [
        { id: "t1", pnl: -100 },
        { id: "a", pnl: -150 },
      ],
    };
    expect(
      verdict({ pnl: -100 }, {}, ctx, "daily_loss_limit").status,
    ).toBe("adhered");
  });

  it("a day that recovers above the line no longer breaches", () => {
    const ctx: PlanDayContext = {
      openedDayTradeIds: ["a", "b", "t1"],
      closedDayTrades: [
        { id: "a", pnl: -250 },
        { id: "b", pnl: 300 },
        { id: "t1", pnl: 10 },
      ],
    };
    expect(verdict({}, {}, ctx, "daily_loss_limit").status).toBe("adhered");
  });

  it("an open trade cannot move realised P&L — not_evaluable", () => {
    expect(
      verdict(
        { status: "open", closedAt: null, pnl: null },
        {},
        CONTEXT,
        "daily_loss_limit",
      ).status,
    ).toBe("not_evaluable");
  });

  it("a zero or unset plan limit is not_evaluable (mirrors the risk engine)", () => {
    expect(
      verdict({}, { max_daily_loss: 0 }, CONTEXT, "daily_loss_limit").status,
    ).toBe("not_evaluable");
    expect(
      verdict({}, { max_daily_loss: null }, CONTEXT, "daily_loss_limit")
        .status,
    ).toBe("not_evaluable");
  });
});

/**
 * Account A fixture — A's REAL plan and closed trades, read
 * from production on 2026-11-03 (docs/task-19-plan-
 * enforcement.md §6). A's profile has NO trading capital, so
 * every risk figure is underivable; the plan names NO
 * preferred setups. The honest verdicts:
 * - market: EURUSD + GBPUSD breach (plan lists only XAUUSD)
 * - session: the two London trades breach (plan trades Asia);
 *   the five trades with no recorded session are not_evaluable
 * - setup / risk: not_evaluable for all eight
 * - day terms: no day crosses (max 5 opened on 2026-10-30 =
 *   the limit, not over it; every day's P&L is positive)
 */
describe("account A fixture (real plan, real trades)", () => {
  const aPlan: TradingPlan = {
    id: "178f13c3-583a-4174-b0b1-1b66e4957cb4",
    user_id: "c4838c9d-babd-4d8c-9008-e0b1991aaa00",
    name: "Audit Trading Plan",
    markets: ["XAUUSD"],
    sessions: ["asia"],
    risk_per_trade_pct: 1,
    max_daily_loss: 200,
    max_daily_trades: 5,
    preferred_setup_ids: [],
    no_trade_conditions: "No trading during high-impact news releases",
    psychology_rules: "Stop after two consecutive losses",
    schedule: {},
    is_active: true,
  };

  interface ATrade {
    id: string;
    pair: string;
    session: PlanTradeInput["session"];
    pnl: number;
    openedAt: string;
    closedAt: string;
    dayIds: string[];
    closedDay: { id: string; pnl: number }[];
  }

  const oct28Open = [
    "06426040-a727-45bc-99d7-176a9c8ca3a5",
    "28a9f6eb-4744-45eb-b52b-973c836d0749",
  ];
  const oct28Closed = [
    { id: "06426040-a727-45bc-99d7-176a9c8ca3a5", pnl: 1000 },
    { id: "28a9f6eb-4744-45eb-b52b-973c836d0749", pnl: 1200 },
  ];
  const oct30Open = [
    "afcc3db3-70e5-4c60-8737-3eb46c7aa358",
    "6bc633ea-d1be-4098-9a0d-aac9b98a31f4",
    "0f6b4ead-c42e-4171-8a54-1007e20b2789",
    "d99354d9-54cf-4efd-a7eb-efdaeb3540f4",
    "61ef4f13-3642-4b51-99ab-06ef0e8bc052",
  ];
  const oct30Closed = [
    { id: "afcc3db3-70e5-4c60-8737-3eb46c7aa358", pnl: 0.5 },
    { id: "6bc633ea-d1be-4098-9a0d-aac9b98a31f4", pnl: 0.5 },
    { id: "0f6b4ead-c42e-4171-8a54-1007e20b2789", pnl: 0.5 },
    { id: "d99354d9-54cf-4efd-a7eb-efdaeb3540f4", pnl: -0.2 },
    { id: "61ef4f13-3642-4b51-99ab-06ef0e8bc052", pnl: 1500 },
  ];

  const aTrades: ATrade[] = [
    { id: oct28Open[0], pair: "XAUUSD", session: null, pnl: 1000, openedAt: "2026-10-28T09:00:00Z", closedAt: "2026-10-28T10:00:00Z", dayIds: oct28Open, closedDay: oct28Closed },
    { id: oct28Open[1], pair: "XAUUSD", session: "london", pnl: 1200, openedAt: "2026-10-28T10:00:00Z", closedAt: "2026-10-28T11:00:00Z", dayIds: oct28Open, closedDay: oct28Closed },
    { id: "a227846a-c32b-46f2-9722-c2857843d741", pair: "XAUUSD", session: "london", pnl: 1.2, openedAt: "2026-10-29T09:00:00Z", closedAt: "2026-10-29T10:00:00Z", dayIds: ["a227846a-c32b-46f2-9722-c2857843d741"], closedDay: [{ id: "a227846a-c32b-46f2-9722-c2857843d741", pnl: 1.2 }] },
    { id: oct30Open[0], pair: "XAUUSD", session: null, pnl: 0.5, openedAt: "2026-10-30T03:00:00Z", closedAt: "2026-10-30T03:30:00Z", dayIds: oct30Open, closedDay: oct30Closed },
    { id: oct30Open[1], pair: "XAUUSD", session: null, pnl: 0.5, openedAt: "2026-10-30T03:00:00Z", closedAt: "2026-10-30T03:30:00Z", dayIds: oct30Open, closedDay: oct30Closed },
    { id: oct30Open[2], pair: "EURUSD", session: null, pnl: 0.5, openedAt: "2026-10-30T08:00:00Z", closedAt: "2026-10-30T09:00:00Z", dayIds: oct30Open, closedDay: oct30Closed },
    { id: oct30Open[3], pair: "GBPUSD", session: null, pnl: -0.2, openedAt: "2026-10-30T09:30:00Z", closedAt: "2026-10-30T10:15:00Z", dayIds: oct30Open, closedDay: oct30Closed },
    { id: oct30Open[4], pair: "XAUUSD", session: null, pnl: 1500, openedAt: "2026-10-30T10:30:00Z", closedAt: "2026-10-30T11:00:00Z", dayIds: oct30Open, closedDay: oct30Closed },
  ];

  it("produces exactly 4 breaches: 2 market + 2 session, nothing else", () => {
    const breaches: { trade: string; term: string }[] = [];
    const notEvaluable = new Map<string, number>();
    for (const t of aTrades) {
      const input: PlanTradeInput = {
        id: t.id,
        pair: t.pair,
        session: t.session,
        setupId:
          t.id === "a227846a-c32b-46f2-9722-c2857843d741"
            ? "876bbdb9-f43f-4362-9c8b-69817278be97"
            : null,
        riskPct: null, // A has no trading capital recorded.
        pnl: t.pnl,
        status: "closed",
        openedAt: t.openedAt,
        closedAt: t.closedAt,
      };
      const all = evaluateTradeAgainstPlan(input, aPlan, {
        openedDayTradeIds: t.dayIds,
        closedDayTrades: t.closedDay,
      });
      for (const v of all) {
        if (v.status === "breached") breaches.push({ trade: t.id, term: v.term });
        if (v.status === "not_evaluable") {
          notEvaluable.set(v.term, (notEvaluable.get(v.term) ?? 0) + 1);
        }
      }
    }
    expect(breaches).toEqual([
      { trade: "28a9f6eb-4744-45eb-b52b-973c836d0749", term: "session" },
      { trade: "a227846a-c32b-46f2-9722-c2857843d741", term: "session" },
      { trade: "0f6b4ead-c42e-4171-8a54-1007e20b2789", term: "market" },
      { trade: "d99354d9-54cf-4efd-a7eb-efdaeb3540f4", term: "market" },
    ]);
    // Setup (plan names none) and risk (no capital) can never
    // be judged for A — not_evaluable on all 8 trades. Session
    // is not_evaluable on the 6 trades that never recorded
    // one. Market and both day terms judge all 8.
    expect(Object.fromEntries(notEvaluable)).toEqual({
      session: 6,
      setup: 8,
      risk_per_trade: 8,
    });
  });
});
