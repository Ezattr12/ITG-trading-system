/**
 * Coach LLM narration layer (Phase 22).
 *
 * The deterministic Coach Engine is the only source of
 * trading facts in ITG TraderOS. This module is the OPTIONAL
 * narration layer the Stage 5 foundation anticipated
 * (docs/ai-coach-foundation.md §2: "optional LLM narration
 * over the tool outputs ONLY"): a provider rewrites an
 * already-computed, structured coach answer in prose. It
 * never queries data, never computes a figure, and its
 * output is accepted only after the hallucination guard
 * below proves every number in it was already present in
 * the deterministic answer it narrates.
 *
 * No LLM is a valid configuration: with neither
 * ANTHROPIC_API_KEY nor OPENAI_API_KEY set, resolution
 * returns null and callers use the deterministic answer
 * as-is — the same honesty rule as the rest of the coach
 * ("No LLM is a valid configuration", foundation §2.2).
 *
 * Plain fetch only — no SDK dependencies. Keys are read
 * from the server environment, never sent to the browser,
 * never logged.
 */

/** Default models, one place. Override with COACH_LLM_MODEL. */
export const COACH_LLM_DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
} as const;

/** Hard cap on one narration call; a timeout falls back. */
export const COACH_LLM_TIMEOUT_MS = 15_000;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TOKENS = 1024;

export type CoachLlmFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface CoachLlmNarrateInput {
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
}

export interface CoachLlmProvider {
  /** "anthropic" | "openai" — surfaced in the answer so the UI can be honest. */
  name: string;
  model: string;
  narrate(input: CoachLlmNarrateInput): Promise<string>;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function anthropicProvider(
  apiKey: string,
  model: string,
  fetchImpl: CoachLlmFetch,
): CoachLlmProvider {
  return {
    name: "anthropic",
    model,
    async narrate({ systemPrompt, userPrompt, signal }) {
      const res = await fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic narration failed: HTTP ${res.status}`);
      const json = (await res.json()) as {
        content?: { type?: string; text?: string }[];
      };
      const text = (json.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n")
        .trim();
      if (!text) throw new Error("anthropic narration returned no text");
      return text;
    },
  };
}

function openAiProvider(
  apiKey: string,
  model: string,
  fetchImpl: CoachLlmFetch,
): CoachLlmProvider {
  return {
    name: "openai",
    model,
    async narrate({ systemPrompt, userPrompt, signal }) {
      const res = await fetchImpl(OPENAI_URL, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai narration failed: HTTP ${res.status}`);
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = (json.choices?.[0]?.message?.content ?? "").trim();
      if (!text) throw new Error("openai narration returned no text");
      return text;
    },
  };
}

/**
 * Resolve the configured narration provider from the
 * environment: Anthropic first when both keys exist (one
 * provider per deployment is the norm; the order is fixed
 * so behaviour is predictable). Returns null when no key
 * is configured — deterministic mode, NOT an error.
 */
export function resolveCoachLlmProvider(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: CoachLlmFetch = fetch,
): CoachLlmProvider | null {
  const modelOverride = nonEmpty(env.COACH_LLM_MODEL);
  const anthropicKey = nonEmpty(env.ANTHROPIC_API_KEY);
  if (anthropicKey) {
    return anthropicProvider(
      anthropicKey,
      modelOverride ?? COACH_LLM_DEFAULT_MODELS.anthropic,
      fetchImpl,
    );
  }
  const openAiKey = nonEmpty(env.OPENAI_API_KEY);
  if (openAiKey) {
    return openAiProvider(
      openAiKey,
      modelOverride ?? COACH_LLM_DEFAULT_MODELS.openai,
      fetchImpl,
    );
  }
  return null;
}

/* ------------------------------------------------ hallucination guard */

/**
 * Numeric tokens in free text: optional sign, optional
 * currency symbol, comma-grouped or plain digits, optional
 * decimals, optional trailing %. Dates yield their
 * components (2026-10-12 → 2026, 10, 12), which is correct:
 * the guard allows exactly the components the evidence
 * itself contains.
 */
const NUMBER_TOKEN_RE = /-?\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|-?\d+(?:\.\d+)?%?/g;

export function extractNumericTokens(text: string): number[] {
  const out: number[] = [];
  for (const match of text.match(NUMBER_TOKEN_RE) ?? []) {
    const value = Number(match.replace(/[$,%]/g, ""));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

function roundedForms(value: number): string[] {
  return [value.toFixed(2), value.toFixed(1), value.toFixed(0)];
}

/**
 * Every number a narration is allowed to use, collected
 * from the deterministic answer it narrates: numeric
 * fields anywhere in the structure, plus the numeric
 * tokens inside its own fact / inference / recommendation
 * strings (so a figure the engine already displays is
 * reusable verbatim). Each value contributes its 0/1/2-
 * decimal rounded forms — a narration may write "3703" or
 * "3,702.50" for 3702.5, but never a different figure.
 */
export function collectAllowedNumbers(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      for (const form of roundedForms(value)) into.add(form);
    }
    return into;
  }
  if (typeof value === "string") {
    for (const token of extractNumericTokens(value)) {
      for (const form of roundedForms(token)) into.add(form);
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAllowedNumbers(item, into);
    return into;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectAllowedNumbers(item, into);
    }
  }
  return into;
}

/**
 * Numbers in `text` that are NOT formatting variants of
 * any allowed number. An empty result means the text
 * invented nothing.
 */
export function findForeignNumbers(text: string, allowed: Set<string>): number[] {
  return extractNumericTokens(text).filter(
    (token) => !roundedForms(token).some((form) => allowed.has(form)),
  );
}

export interface CoachNarration {
  text: string;
  provider: string;
  model: string;
}

/**
 * Run one narration under the guard. Returns the accepted
 * text, or null for EVERY failure mode — provider error,
 * timeout (AbortController), empty/malformed output, or a
 * single foreign number — so the caller falls back to the
 * deterministic answer. The guard's verdict is final: a
 * rejected narration is discarded whole, never edited.
 */
export async function narrateWithGuard(args: {
  provider: CoachLlmProvider;
  systemPrompt: string;
  userPrompt: string;
  /** The deterministic answer the narration may draw numbers from. */
  allowedSource: unknown;
  timeoutMs?: number;
}): Promise<CoachNarration | null> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? COACH_LLM_TIMEOUT_MS,
  );
  try {
    const text = await args.provider.narrate({
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      signal: controller.signal,
    });
    if (!text || text.trim() === "") return null;
    const allowed = collectAllowedNumbers(args.allowedSource);
    if (findForeignNumbers(text, allowed).length > 0) return null;
    return { text, provider: args.provider.name, model: args.provider.model };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
