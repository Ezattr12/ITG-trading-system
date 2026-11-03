import { describe, expect, it } from "vitest";
import {
  collectAllowedNumbers,
  extractNumericTokens,
  findBannedContent,
  findForeignNumbers,
  narrateWithGuard,
  resolveCoachLlmProvider,
  type CoachLlmFetch,
  type CoachLlmNarrateInput,
  type CoachLlmProvider,
} from "./llm";

/**
 * LLM narration layer (Phase 22). The provider is always
 * mocked — no test makes a real external call. The guard
 * tests are the hallucination contract: a narration may
 * only ever restate numbers the deterministic answer
 * already contains.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveCoachLlmProvider", () => {
  const fetchImpl: CoachLlmFetch = async () => jsonResponse({});

  it("no keys configured → null (deterministic mode is a valid configuration)", () => {
    expect(resolveCoachLlmProvider({}, fetchImpl)).toBeNull();
    expect(resolveCoachLlmProvider({ ANTHROPIC_API_KEY: "  " }, fetchImpl)).toBeNull();
  });

  it("ANTHROPIC_API_KEY → anthropic provider with the default model", () => {
    const provider = resolveCoachLlmProvider({ ANTHROPIC_API_KEY: "sk-test" }, fetchImpl);
    expect(provider?.name).toBe("anthropic");
    expect(provider?.model).toBe("claude-sonnet-4-5");
  });

  it("OPENAI_API_KEY → openai provider with the default model", () => {
    const provider = resolveCoachLlmProvider({ OPENAI_API_KEY: "sk-test" }, fetchImpl);
    expect(provider?.name).toBe("openai");
    expect(provider?.model).toBe("gpt-4o-mini");
  });

  it("both keys → anthropic wins (fixed, predictable order)", () => {
    const provider = resolveCoachLlmProvider(
      { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" },
      fetchImpl,
    );
    expect(provider?.name).toBe("anthropic");
  });

  it("COACH_LLM_MODEL overrides the default model", () => {
    const provider = resolveCoachLlmProvider(
      { OPENAI_API_KEY: "sk-test", COACH_LLM_MODEL: "gpt-custom" },
      fetchImpl,
    );
    expect(provider?.model).toBe("gpt-custom");
  });
});

describe("provider wire formats (mocked fetch)", () => {
  it("anthropic: sends the Messages API shape and joins text blocks", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: CoachLlmFetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        content: [
          { type: "text", text: "FACTS" },
          { type: "text", text: "- One fact." },
        ],
      });
    };
    const provider = resolveCoachLlmProvider({ ANTHROPIC_API_KEY: "sk-secret" }, fetchImpl);
    const text = await provider!.narrate({
      systemPrompt: "SYS",
      userPrompt: "USER",
      signal: new AbortController().signal,
    });
    expect(text).toBe("FACTS\n- One fact.");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-secret");
    const body = JSON.parse(String(calls[0].init.body)) as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.system).toBe("SYS");
    expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
  });

  it("openai: sends the chat-completions shape and reads the message content", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: CoachLlmFetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ choices: [{ message: { content: "Narrated." } }] });
    };
    const provider = resolveCoachLlmProvider({ OPENAI_API_KEY: "sk-secret" }, fetchImpl);
    const text = await provider!.narrate({
      systemPrompt: "SYS",
      userPrompt: "USER",
      signal: new AbortController().signal,
    });
    expect(text).toBe("Narrated.");
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-secret");
    const body = JSON.parse(String(calls[0].init.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages[1]).toEqual({ role: "user", content: "USER" });
  });

  it("HTTP error → narrate rejects (the guard wrapper turns it into a fallback)", async () => {
    const fetchImpl: CoachLlmFetch = async () => jsonResponse({ error: "nope" }, 500);
    const provider = resolveCoachLlmProvider({ ANTHROPIC_API_KEY: "sk" }, fetchImpl);
    await expect(
      provider!.narrate({
        systemPrompt: "S",
        userPrompt: "U",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
  });

  it("malformed success payload (no text) → narrate rejects", async () => {
    const fetchImpl: CoachLlmFetch = async () => jsonResponse({ content: [] });
    const provider = resolveCoachLlmProvider({ ANTHROPIC_API_KEY: "sk" }, fetchImpl);
    await expect(
      provider!.narrate({
        systemPrompt: "S",
        userPrompt: "U",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
  });
});

describe("number extraction + allowed set", () => {
  it("extracts plain, decimal, comma-grouped, currency and percent tokens", () => {
    expect(extractNumericTokens("P&L 3,702.50, win rate 87.5%, factor 2, R -1.5")).toEqual([
      3702.5, 87.5, 2, -1.5,
    ]);
  });

  it("collects numbers from nested structures and from display strings", () => {
    const allowed = collectAllowedNumbers({
      totalPnl: 3702.5,
      facts: ["Win rate 87.5% across 8 trades"],
      nested: { periodStart: "2026-10-12" },
    });
    expect(findForeignNumbers("Total 3702.50 over 8 trades (87.5%)", allowed)).toEqual([]);
    expect(findForeignNumbers("Week of 2026-10-12", allowed)).toEqual([]);
    expect(findForeignNumbers("Total 9999", allowed)).toEqual([9999]);
  });

  it("rounding variants are allowed; different figures are not", () => {
    const allowed = collectAllowedNumbers({ totalPnl: 3702.5 });
    expect(findForeignNumbers("about 3703 in total", allowed)).toEqual([]);
    expect(findForeignNumbers("about 3702 in total", allowed)).toEqual([3702]);
  });
});

describe("narrateWithGuard — fallback contract", () => {
  const allowedSource = {
    facts: ["Total P&L 100.00 across 3 trades, win rate 66.7%."],
    evidence: { tradesCount: 3, totalPnl: 100 },
  };

  function providerReturning(text: string): CoachLlmProvider {
    return { name: "mock", model: "mock-1", narrate: async () => text };
  }

  it("accepts a narration that only restates evidence numbers (any formatting)", async () => {
    const result = await narrateWithGuard({
      provider: providerReturning("FACTS\n- Total P&L 100.00 across 3 trades, win rate 66.7%."),
      systemPrompt: "S",
      userPrompt: "U",
      allowedSource,
    });
    expect(result?.provider).toBe("mock");
    expect(result?.text).toContain("100.00");
  });

  it("a single foreign number discards the whole narration", async () => {
    const result = await narrateWithGuard({
      provider: providerReturning("FACTS\n- Total P&L 100.00 — your best week ever at 9999.00."),
      systemPrompt: "S",
      userPrompt: "U",
      allowedSource,
    });
    expect(result).toBeNull();
  });

  it("an invented percentage is foreign even when other numbers are fine", async () => {
    const result = await narrateWithGuard({
      provider: providerReturning("FACTS\n- Win rate 95% across 3 trades."),
      systemPrompt: "S",
      userPrompt: "U",
      allowedSource,
    });
    expect(result).toBeNull();
  });

  it("provider throwing → null (fallback), never an exception", async () => {
    const provider: CoachLlmProvider = {
      name: "mock",
      model: "mock-1",
      narrate: async () => {
        throw new Error("provider down");
      },
    };
    await expect(
      narrateWithGuard({ provider, systemPrompt: "S", userPrompt: "U", allowedSource }),
    ).resolves.toBeNull();
  });

  it("empty narration → null", async () => {
    await expect(
      narrateWithGuard({
        provider: providerReturning("   "),
        systemPrompt: "S",
        userPrompt: "U",
        allowedSource,
      }),
    ).resolves.toBeNull();
  });

  it("timeout: a provider that only answers after the abort → null", async () => {
    const provider: CoachLlmProvider = {
      name: "mock",
      model: "mock-1",
      narrate: ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const started = Date.now();
    const result = await narrateWithGuard({
      provider,
      systemPrompt: "S",
      userPrompt: "U",
      allowedSource,
      timeoutMs: 25,
    });
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a number-free trade instruction is discarded whole by the banned-content screen", async () => {
    const result = await narrateWithGuard({
      provider: providerReturning(
        [
          "FACTS",
          "- Total P&L 100.00 across 3 trades, win rate 66.7%.",
          "INFERENCES",
          "- The week was profitable on the recorded data.",
          "RECOMMENDATIONS",
          "- Buy gold now while this works.",
        ].join("\n"),
      ),
      systemPrompt: "S",
      userPrompt: "U",
      allowedSource,
    });
    expect(result).toBeNull();
  });

  it("descriptive narration about the trader's own positions passes both guards", async () => {
    const result = await narrateWithGuard({
      provider: providerReturning(
        [
          "FACTS",
          "- Total P&L 100.00 across 3 trades, win rate 66.7%.",
          "INFERENCES",
          "- Your short trades dragged the week; the longs carried it.",
          "RECOMMENDATIONS",
          "- Consider reviewing your stop placement before the next session.",
        ].join("\n"),
      ),
      systemPrompt: "S",
      userPrompt: "U",
      allowedSource,
    });
    expect(result?.provider).toBe("mock");
    expect(result?.text).toContain("Consider reviewing your stop placement");
  });

  it("the provider receives the caller's prompts verbatim and an abort signal", async () => {
    const receivedInputs: CoachLlmNarrateInput[] = [];
    const provider: CoachLlmProvider = {
      name: "mock",
      model: "mock-1",
      narrate: async (input) => {
        receivedInputs.push(input);
        return "FACTS\n- Total P&L 100.00.";
      },
    };
    await narrateWithGuard({
      provider,
      systemPrompt: "SYSTEM PROMPT",
      userPrompt: "USER PROMPT",
      allowedSource,
    });
    expect(receivedInputs).toHaveLength(1);
    expect(receivedInputs[0].systemPrompt).toBe("SYSTEM PROMPT");
    expect(receivedInputs[0].userPrompt).toBe("USER PROMPT");
    expect(receivedInputs[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("findBannedContent — the Task 16 banned-content screen", () => {
  /**
   * The line: an instruction to trade a market NOW is
   * banned; coaching about the trader's process and
   * recorded past is not. Rejection is the safe failure
   * (the deterministic answer is shown instead), so the
   * screen keys on imperative shapes — sentence-initial
   * execution verbs, modals, advised trade gerunds,
   * direction + instrument, urgency, prediction and
   * promise phrasing — never on direction words alone.
   */
  const REJECTED: [string, string][] = [
    ["Buy gold now.", "direction-instrument"],
    ["You should short EURUSD here.", "modal-trade-instruction"],
    ["You must close the trade before the news.", "modal-trade-instruction"],
    ["Short EURUSD at market.", "direction-instrument"],
    ["Enter a position before the news.", "execution-phrase"],
    ["Place a trade today.", "execution-phrase"],
    ["Take this trade — the setup aligns with your best pattern.", "execution-phrase"],
    ["Go long on gold while momentum is with you.", "execution-phrase"],
    ["We recommend buying gold at these levels.", "advised-trade-instruction"],
    ["Consider buying gold here — your London entries work.", "advised-trade-instruction"],
    ["Gold will reach a new high this month.", "price-prediction"],
    ["The price is going to hit the level you marked.", "price-prediction"],
    ["This approach is guaranteed to work if you stay disciplined.", "outcome-promise"],
    ["You can't lose with this setup.", "outcome-promise"],
    ["It is risk-free profit when the setup appears.", "outcome-promise"],
    ["Act now, before it's too late.", "urgency"],
    ["Hold your position through the announcement.", "hold-instruction"],
    ["- Sell the position and wait.", "imperative-line-start"],
  ];

  it.each(REJECTED)("rejects %s (%s)", (text, rule) => {
    expect(findBannedContent(text)).toContain(rule);
  });

  const ACCEPTED: string[] = [
    // Past tense / possessive description of the trader's own record.
    "You bought gold three times this month; two of those buys lost money.",
    "Your short gold trades lost 50.00 in October, while your longs carried the month.",
    "Your shorts underperformed your longs across the month.",
    "Short trades lost more than long trades this month.",
    "Most of your profit came from long trades on gold.",
    "You tend to exit winners early and hold losers too long.",
    "Your stop was hit on the two losing trades.",
    // Process advice — including "consider" + a process gerund.
    "Consider reviewing your stop placement before the next session.",
    "Consider tightening your stop placement on gold trades.",
    "Review the three losing trades and note what they shared.",
    "Keeping position sizes small protected your capital.",
    "- Keep the routine that produced this week.",
    "- Closed trades: 8 of your 10 journal entries this month.",
    "- Open trades averaged a smaller size than the closed ones.",
    // The shipped clean-narration shape (chat.test.ts GOOD_NARRATION).
    [
      "FACTS",
      "- Profitable week: 100.00 across 3 trades.",
      "INFERENCES",
      "- The week was profitable on the recorded data.",
      "RECOMMENDATIONS",
      "- Keep the routine that produced this week.",
    ].join("\n"),
  ];

  it.each(ACCEPTED)("accepts coaching prose: %s", (text) => {
    expect(findBannedContent(text)).toEqual([]);
  });

  it("returns every tripped rule, in rule order, without duplicates", () => {
    expect(findBannedContent("Buy gold now — guaranteed.")).toEqual([
      "imperative-line-start",
      "direction-instrument",
      "outcome-promise",
    ]);
  });

  it("empty and number-only text is clean", () => {
    expect(findBannedContent("")).toEqual([]);
    expect(findBannedContent("3702.50 · 87.5% · 8 closed trades")).toEqual([]);
  });
});
