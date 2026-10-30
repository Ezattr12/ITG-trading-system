# AI Coach foundation — architecture (Stage 5)

Goal: a coach that understands the trader's history —
trades, strategies, setups, performance, risk, psychology,
mistakes, lessons, goals, discipline and progress — and
speaks only from cited, real data. This document is the
foundation design; the deterministic engine that already
powers /coach (Phase 9, `lib/coach/insights.ts`) is its
starting point, not a prototype to discard.

## 1. What exists today (verified in production)

- Deterministic weekly insights on /coach: every insight
  carries a `metrics_snapshot`; minimum-sample honesty
  ("needs at least 3 closed trades"); refresh is a user
  action, idempotent per week (migration 0013).
- Dashboard surfaces the latest insights (real data only).
- XP/level/goal/risk engines the coach reasons over are
  all deterministic and unit-tested.
- `ai_insights` table with snapshot storage and RLS.

## 2. Target pipeline

```
Trade closed (existing create/update actions)
  → analysis job (queued, idempotent per trade+week)
    → reads via the MCP tool layer (Stage 3/4 tools,
      authenticated as the trader — same tenant rules)
    → deterministic analysis (existing engines)
    → optional LLM narration over the tool outputs ONLY
    → saved insight / weekly review draft (ai_insights,
      metrics_snapshot attached)
  → dashboard + /coach presentation (already built)
  → trader feedback loop (review text, lessons) feeds the
    next week's context
```

Design decisions:

1. **Tools before text.** Any future LLM component receives
   tool outputs (numbers + findings) and may only narrate
   them. It never queries the database directly, never
   invents a figure, and its output is stored alongside the
   exact snapshot it narrated — if the narration and the
   snapshot disagree, the snapshot wins in the UI.
2. **No LLM is a valid configuration.** With no model
   connected, the deterministic findings ARE the coach
   (today's production behavior, stated honestly in the
   UI). Connecting a model is an enhancement, never a
   dependency, and never faked.
3. **Jobs, not request-time work.** Analysis runs as a
   bounded background job (idempotency key: user + week +
   trigger trade), so closing a trade stays fast and a
   failed analysis retries without duplicating insights.
   In the current stack this maps to a server action /
   route handler invoked on trade close + the existing
   manual refresh; a real queue is adopted only when
   volume justifies it.
4. **Context assembly is explicit.** The coach's picture of
   the trader is assembled from named tools (performance
   summary, strategy/session breakdowns, psychology
   summary, risk status, goals, discipline, level) — the
   Stage 4 catalog. Each context block records its source
   tool and time range, so any coach statement can be
   traced to the data behind it.
5. **Memory is the trader's own data.** "Coach memory" =
   stored reviews, lessons, repeated-mistake detection
   (already in lib/trades/lessons.ts) and prior insights —
   all in the trader's tenant, all deletable by the trader
   through the existing journal. No cross-user learning on
   private data.
6. **Tone guardrails are product rules:** supportive,
   specific, numbers-first; never shaming (matches the
   discipline engine's Day 1/2/3 supportive reminders);
   never financial advice phrased as instruction ("consider
   reviewing X" with the data, not "do Y trade").
7. **Hard boundary:** the coach cannot execute, modify or
   delete trades, change risk rules, or move money. Its
   only writes are insights/reviews drafts in the trader's
   own tenant, through the existing audited actions.

## 3. Data the coach reasons over (all existing)

trades + psychology_records + lessons (per-trade);
analytics aggregates (strategy/session/direction/
psychology); risk rules + risk_events + active plan;
goals + goal_progress; discipline_events +
notifications; xp_transactions + user_levels +
user_achievements; weekly_reviews; daily_activity;
certificates (eligibility state).

## 4. Rollout order

1. ✅ Stage 3 POC tools (get_trade, analyze_trade) — proves
   the authenticated read path. **Done (2026-10-29).**
2. ✅ Stage 4 read tools as justified. **Done (2026-10-29).**
3. ✅ Wire the trade-close trigger to refresh the current
   week's deterministic insights (idempotent job).
   **Done in Phase 20 (2026-10-30)** — closing, correcting
   or re-reviewing a closed trade refreshes that week's
   insights through the shared coach service; the same
   phase exposed `compute_coach_insights` via the internal
   endpoint. See `docs/phase-20.md`.
4. Only then evaluate an LLM narration layer behind a
   config flag, default off, with snapshot-diff checks in
   tests (narration may not introduce numbers absent from
   the snapshot). **Future — not started.**

## 5. Verification

Per-step: unit tests on context assembly (right tools,
right ranges); snapshot fidelity tests; tenant-isolation
tests identical to the MCP suite; production verification
on the test account exactly like Stages 1–2 (real flows,
DB cross-checks, no fake data).
