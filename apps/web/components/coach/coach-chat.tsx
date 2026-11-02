"use client";

import { useState } from "react";

/**
 * Interactive AI Coach chat (Phase 22).
 *
 * The trader asks a question; the server answers ONLY from
 * their own stored trades, through the deterministic Coach
 * Engine (optionally narrated by a connected LLM, guarded
 * so it cannot invent figures). Every answer renders its
 * FACTS / INFERENCES / RECOMMENDATIONS separately, an
 * evidence line, and a badge stating exactly how the
 * answer was produced — "AI-narrated" when a language
 * model rewrote the engine's analysis, "Deterministic
 * analysis" when it did not. Nothing here claims a model
 * is involved when one is not.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION
 * ONLY: the turns sit on .itg2-inset wells inside the
 * page's AI card, the narration badge is an .itg2-chip
 * (.itg2-chip-ai when a model narrated, .itg2-chip-muted
 * when it did not), the suggestion chips are .itg2-chip-btn
 * ghost pills, the question field is .itg2-input and the
 * submit a native button on .itg2-btn-ai. The ask()
 * pipeline, history building and every string are exactly
 * as before.
 */

interface CoachEvidence {
  scope: string;
  periodStart: string | null;
  periodEnd: string | null;
  tradesCount: number | null;
  totalPnl: number | null;
  winRate: number | null;
  profitFactor: number | null;
  avgR: number | null;
}

interface CoachAnswer {
  status: "ok" | "insufficient_data";
  intent: string;
  facts: string[];
  inferences: string[];
  recommendations: string[];
  evidence: CoachEvidence;
  narration: "llm" | "deterministic";
  narrationProvider?: string;
}

type Turn =
  | { kind: "user"; content: string }
  | { kind: "coach"; answer: CoachAnswer };

const SUGGESTIONS = [
  "What is my biggest trading weakness?",
  "Analyze my last 30 trades",
  "Which strategy performs best?",
  "Which session performs best?",
  "What mistakes do I repeat?",
  "How is my psychology affecting my results?",
  "Compare this month with last month",
  "What should I focus on this week?",
];

function evidenceLine(e: CoachEvidence): string {
  const parts: string[] = [e.scope];
  if (e.tradesCount !== null) parts.push(`${e.tradesCount} closed trades`);
  if (e.totalPnl !== null) parts.push(`total P&L ${e.totalPnl.toFixed(2)}`);
  if (e.winRate !== null) parts.push(`win rate ${e.winRate}%`);
  if (e.profitFactor !== null) parts.push(`profit factor ${e.profitFactor.toFixed(2)}`);
  if (e.avgR !== null) parts.push(`average R ${e.avgR.toFixed(2)}`);
  return parts.join(" · ");
}

function AnswerSections({ answer }: { answer: CoachAnswer }) {
  const section = (title: string, lines: string[]) =>
    lines.length === 0 ? null : (
      <div key={title}>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`itg2-chip ${answer.narration === "llm" ? "itg2-chip-ai" : "itg2-chip-muted"}`}
        >
          {answer.narration === "llm"
            ? `AI-narrated${answer.narrationProvider ? ` · ${answer.narrationProvider}` : ""}`
            : "Deterministic analysis"}
        </span>
        {answer.status === "insufficient_data" && (
          <span className="itg2-chip itg2-chip-warning">Not enough data yet</span>
        )}
      </div>
      {section("Facts", answer.facts)}
      {section("Inferences", answer.inferences)}
      {section("Recommendations", answer.recommendations)}
      <p className="text-xs text-muted-foreground">Evidence: {evidenceLine(answer.evidence)}.</p>
    </div>
  );
}

export function CoachChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const message = question.trim();
    if (message === "" || pending) return;
    setError(null);
    setPending(true);
    const history = turns.slice(-6).map((turn) =>
      turn.kind === "user"
        ? { role: "user" as const, content: turn.content }
        : {
            role: "assistant" as const,
            content: [
              ...turn.answer.facts,
              ...turn.answer.inferences,
              ...turn.answer.recommendations,
            ].join("\n"),
          },
    );
    setTurns((prev) => [...prev, { kind: "user", content: message }]);
    setInput("");
    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = (await res.json().catch(() => null)) as CoachAnswer | { message?: string } | null;
      if (!res.ok || !data || !("facts" in data)) {
        setError(
          (data && "message" in data && data.message) ||
            "The coach could not answer just now. Please try again.",
        );
        return;
      }
      setTurns((prev) => [...prev, { kind: "coach", answer: data }]);
    } catch {
      setError("The coach could not be reached. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {turns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ask about your weakness, your strategies, a session, your psychology, your discipline —
          or tap a question to start. Answers come only from your own recorded trades; the coach
          cannot place or change trades.
        </p>
      ) : (
        <div className="space-y-4" aria-live="polite">
          {turns.map((turn, i) =>
            turn.kind === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="itg2-inset max-w-[85%] px-4 py-2.5 text-sm">{turn.content}</p>
              </div>
            ) : (
              <div key={i} className="itg2-inset motion-fade-in px-4 py-3.5">
                <AnswerSections answer={turn.answer} />
              </div>
            ),
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={pending}
            onClick={() => void ask(suggestion)}
            className="itg2-chip-btn"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form
        className="mt-4 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="flex-1">
          <label htmlFor="coach-question" className="sr-only">
            Ask the coach a question
          </label>
          <input
            id="coach-question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            placeholder="Ask about your trading…"
            className="itg2-input"
          />
        </div>
        <button
          type="submit"
          disabled={pending || input.trim() === ""}
          aria-busy={pending}
          className="itg2-btn-ai"
        >
          {pending ? (
            <>
              <span aria-hidden="true" className="motion-ai-dot inline-block h-2 w-2 rounded-full bg-ai" />
              Analysing…
            </>
          ) : (
            "Ask"
          )}
        </button>
      </form>
      {error && (
        <p className="motion-fade-in mt-3 text-sm itg2-text-loss" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
