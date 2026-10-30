import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase } from "@/lib/test-helpers/fake-supabase";
import { answerCoachQuestion, detectCoachIntent } from "@/lib/coach/chat";
import type { CoachLlmProvider } from "@/lib/coach/llm";
import {
  INTEL_USER_A as USER_A,
  INTEL_USER_B as USER_B,
  intelligenceTables,
} from "@/lib/test-helpers/intelligence-fixture";

/**
 * Advanced intelligence — coach integration (Phase 23).
 *
 * The new intents answer through lib/intelligence and the
 * same deterministic/guard pipeline as Phase 22, verified
 * against the hand-computed September fixture in
 * queries.test.ts (max drawdown 300.00; 1 of 5 stop-loss
 * trades over the 1% limit; month total −90.00 across
 * 7 trades; best condition Trending +410.00 across 3).
 */

const NOW = new Date("2026-09-20T12:00:00Z");

function provider(text: string): CoachLlmProvider {
  return { name: "mock", model: "mock-1", narrate: async () => text };
}

describe("intent routing — new intents and Phase 22 regressions", () => {
  it("routes the intelligence questions", () => {
    expect(detectCoachIntent("What is my drawdown?")).toBe("drawdown_analysis");
    expect(detectCoachIntent("How deep was my worst peak to trough decline?")).toBe("drawdown_analysis");
    expect(detectCoachIntent("Am I over-risking my trades?")).toBe("risk_behavior");
    expect(detectCoachIntent("How much do I risk per trade?")).toBe("risk_behavior");
    expect(detectCoachIntent("What are my best trading conditions?")).toBe("trading_conditions");
    expect(detectCoachIntent("When do I trade best?")).toBe("trading_conditions");
    expect(detectCoachIntent("Give me an improvement plan")).toBe("improvement_plan");
    expect(detectCoachIntent("How can I improve?")).toBe("improvement_plan");
    expect(detectCoachIntent("Monthly review please")).toBe("monthly_review");
    expect(detectCoachIntent("Review this month")).toBe("monthly_review");
  });

  it("keeps Phase 22 routing intact", () => {
    expect(detectCoachIntent("Compare this month with last month")).toBe("month_compare");
    expect(detectCoachIntent("What should I focus on this week?")).toBe("weekly_focus");
    expect(detectCoachIntent("What is my biggest trading weakness?")).toBe("biggest_weakness");
    expect(detectCoachIntent("Which strategy is my best?")).toBe("best_strategy");
    expect(detectCoachIntent("Tell me about my trading")).toBe("weekly_overview");
  });
});

describe("intelligence answers", () => {
  it("drawdown answer cites the hand-computed figures", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_A,
      message: "What is my drawdown?",
      llmProvider: null,
      now: NOW,
    });
    expect(answer.intent).toBe("drawdown_analysis");
    expect(answer.status).toBe("ok");
    expect(answer.narration).toBe("deterministic");
    const facts = answer.facts.join(" ");
    expect(facts).toContain("maximum drawdown is 300.00");
    expect(facts).toContain("2026-09-10");
    expect(facts).toContain("290.00 below its peak");
    expect(answer.evidence).toMatchObject({ tradesCount: 7, totalPnl: -90 });
  });

  it("risk answer reports the one over-limit trade", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_A,
      message: "Am I over-risking my trades?",
      llmProvider: null,
      now: NOW,
    });
    expect(answer.intent).toBe("risk_behavior");
    expect(answer.status).toBe("ok");
    expect(answer.facts.join(" ")).toContain(
      "1 of 5 trades planned more than your 1% per-trade limit",
    );
  });

  it("conditions answer ranks the real matrix", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_A,
      message: "What are my best trading conditions?",
      llmProvider: null,
      now: NOW,
    });
    expect(answer.intent).toBe("trading_conditions");
    expect(answer.status).toBe("ok");
    expect(answer.facts[0]).toContain("Best measured condition: Trending");
    expect(answer.facts[0]).toContain("410.00");
  });

  it("improvement plan answer returns the five ranked actions", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_A,
      message: "Give me an improvement plan",
      llmProvider: null,
      now: NOW,
    });
    expect(answer.intent).toBe("improvement_plan");
    expect(answer.status).toBe("ok");
    expect(answer.recommendations).toHaveLength(5);
    expect(answer.facts.join(" ")).toContain("1 of 5");
    expect(answer.recommendations.join(" ")).toContain("Entered before confirmation");
  });

  it("monthly review answers from the assembled digest", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_A,
      message: "Monthly review please",
      llmProvider: null,
      now: NOW,
    });
    expect(answer.intent).toBe("monthly_review");
    expect(answer.status).toBe("ok");
    expect(answer.facts[0]).toContain("2026-09");
    expect(answer.facts[0]).toContain("-90.00");
    expect(answer.facts.join(" ")).toContain("Stored September insight");
  });

  it("monthly review for an empty current month is honestly insufficient", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_A,
      message: "Monthly review please",
      llmProvider: null,
      now: new Date("2026-10-14T12:00:00Z"),
    });
    expect(answer.intent).toBe("monthly_review");
    expect(answer.status).toBe("insufficient_data");
  });

  it("another trader's single trade is insufficient — and never leaks A's figures", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_B,
      message: "What is my drawdown?",
      llmProvider: null,
      now: NOW,
    });
    expect(answer.status).toBe("insufficient_data");
    expect(answer.facts.join(" ")).toContain("1 closed trade");
    expect(answer.facts.join(" ")).not.toContain("300");
  });

  it("a guarded narration can narrate the new intents too", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const answer = await answerCoachQuestion({
      supabase: client as SupabaseClient,
      userId: USER_A,
      message: "What is my drawdown?",
      llmProvider: provider(
        [
          "FACTS",
          "- Maximum drawdown is 300.00.",
          "INFERENCES",
          "- The drawdown is measured from recorded trades.",
          "RECOMMENDATIONS",
          "- Keep risk per trade steady.",
        ].join("\n"),
      ),
      now: NOW,
    });
    expect(answer.narration).toBe("llm");
    expect(answer.narrationProvider).toBe("mock");
    expect(answer.facts).toEqual(["Maximum drawdown is 300.00."]);
  });
});
