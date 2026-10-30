import { describe, expect, it } from "vitest";
import {
  collectAllowedNumbers,
  extractNumericTokens,
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
