import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calcXpFor } from "@itg/calc";
import {
  aggregateXpHistory,
  deterministicUuid,
  totalXp,
  validatePenalty,
  XP_ACTION_LABELS,
} from "./xp";

describe("calcXpFor (spec §24 table)", () => {
  it("awards the spec amounts per action", () => {
    expect(calcXpFor("trade_journal")).toBe(10);
    expect(calcXpFor("daily_goal")).toBe(20);
    expect(calcXpFor("backtest_session")).toBe(15);
    expect(calcXpFor("weekly_review")).toBe(30);
    expect(calcXpFor("risk_discipline")).toBe(25);
    // Achievements carry their own xp_reward, not a table amount.
    expect(calcXpFor("achievement")).toBe(0);
  });

  it("labels every XP action", () => {
    for (const action of Object.keys(XP_ACTION_LABELS)) {
      expect(XP_ACTION_LABELS[action as keyof typeof XP_ACTION_LABELS].length).toBeGreaterThan(0);
    }
  });
});

describe("totalXp / aggregateXpHistory", () => {
  it("sums awards and subtracts penalties", () => {
    expect(
      totalXp([{ amount: 10 }, { amount: 20 }, { amount: -5 }, { amount: 15 }]),
    ).toBe(40);
    expect(totalXp([])).toBe(0);
  });

  it("builds a cumulative history in transaction order", () => {
    const history = aggregateXpHistory([
      { amount: 10, created_at: "2026-10-20T09:00:00.000Z" },
      { amount: 20, created_at: "2026-10-21T09:00:00.000Z" },
      { amount: -5, created_at: "2026-10-22T09:00:00.000Z" },
    ]);
    expect(history).toEqual([
      { date: "2026-10-20", xp: 10, cumulativeXp: 10 },
      { date: "2026-10-21", xp: 20, cumulativeXp: 30 },
      { date: "2026-10-22", xp: -5, cumulativeXp: 25 },
    ]);
  });
});

describe("deterministicUuid", () => {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("produces valid UUID-shaped values (xp_transactions.source_ref_id is uuid)", () => {
    expect(deterministicUuid("backtest:2026-10-27:1")).toMatch(UUID_RE);
    expect(deterministicUuid("anything")).toMatch(UUID_RE);
  });

  it("is stable for the same key (idempotent re-submission)", () => {
    expect(deterministicUuid("backtest:2026-10-29:2")).toBe(
      deterministicUuid("backtest:2026-10-29:2"),
    );
  });

  it("differs across dates and session indexes", () => {
    const a = deterministicUuid("backtest:2026-10-29:1");
    expect(deterministicUuid("backtest:2026-10-29:2")).not.toBe(a);
    expect(deterministicUuid("backtest:2026-10-28:1")).not.toBe(a);
  });

  /**
   * Regression guard for the Stage 2 audit bug (2026-10-29):
   * the backtesting action passed the raw string
   * `backtest:<date>:<n>` as source_ref_id into a uuid column,
   * so every backtest XP insert failed silently and the UI
   * falsely reported the sessions as "already logged".
   */
  it("the coach backtesting action maps its key through deterministicUuid", () => {
    const src = readFileSync(
      join(process.cwd(), "apps/web/lib/coach/actions.ts"),
      "utf8",
    );
    expect(src).toContain(
      "deterministicUuid(`backtest:${activityDate}:${i}`)",
    );
    expect(src).not.toContain("sourceRefId: `backtest:");
  });
});

describe("validatePenalty", () => {
  it("accepts a negative whole number with a written reason", () => {
    expect(validatePenalty(-10, "Traded outside the plan three days running.")).toBeNull();
  });

  it("rejects zero, positive, fractional and reason-less penalties", () => {
    expect(validatePenalty(0, "Reason")).not.toBeNull();
    expect(validatePenalty(10, "Reason")).not.toBeNull();
    expect(validatePenalty(-2.5, "Reason")).not.toBeNull();
    expect(validatePenalty(-10, "")).not.toBeNull();
    expect(validatePenalty(-10, "   ")).not.toBeNull();
    expect(validatePenalty(-10, null)).not.toBeNull();
  });
});
