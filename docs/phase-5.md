# Phase 5 — Risk & Psychology

Status: implemented locally, tested. **Supabase project
ITG-trading-system now exists** (per the parent agent's brief)
but migrations have NOT been applied to it and its keys are NOT
in the app env yet — the pages are real and complete, but they
show honest empty states until migrations are applied and env
vars are set. No demo trades, no fake P&L, no mock risk events.
Not deployed, not committed to GitHub (GitHub App push still
fails 403 — parent agent's blocker, unchanged).

## Correction to the brief
The Phase 5 brief said `risk_events` existed in the Phase 1
migrations. It did not: migration 0005 created only
`trading_plans`, `risk_rules` and `trading_sessions`. Phase 5
therefore adds migration `0011_risk_events.sql` (new table,
`risk_event_type` / `risk_event_severity` enums, RLS owner-only
select, no client insert/update/delete — server-written,
append-only like `audit_logs`). Total tables: 30.

## Spec covered
- §19 Risk engine: configurable rules — max risk per trade %,
  max daily loss, max trades per day, max consecutive losses,
  max leverage. WARNING / CRITICAL / POSITIVE messages exactly
  as specified ("You exceeded your planned daily trade limit.",
  "You reached your daily loss limit.",
  "You followed your risk plan for N consecutive trades.").
  Breaches are logged to `risk_events`, never silently ignored.
- §20 Trading plan: markets, sessions, risk per trade, max
  daily loss/trades, preferred setups, no-trade conditions,
  psychology rules, schedule. Plan-vs-actual comparison from
  real closed trades; rows that cannot be measured from trades
  (psychology rules, no-trade conditions) say so honestly
  (`onTrack: null`) instead of guessing.
- §14 Psychology: dedicated `/psychology` page — emotion,
  confidence and discipline vs performance, from real trades
  and Advanced Review records. The dashboard's psychology
  summary (Phase 4) is unchanged.

## Enforcement semantics (decided in Phase 5)
The engine WARNS — it never auto-executes or closes a real
trade (spec §41). At trade entry only two breached CRITICAL
rules stop a save: the daily loss limit and leverage above the
maximum. Every other breach is a WARNING: the trade is still
journaled (a journal that refuses to record a breach would hide
the behaviour it exists to show) and the breach is logged.
A rule left blank means "no limit set" and is skipped, never
treated as zero. Risk-% is computed only when the trader's
`profiles.trading_capital` is known; otherwise that check is
skipped. The disciplined streak counts consecutive closed trades
with a stop-loss set and leverage within the limit.

## Routes
| Route | Purpose |
|---|---|
| `/risk` | Today's status vs rules, risk rules form, risk events log with resolve |
| `/plan` | Trading plan form + plan-vs-actual table |
| `/psychology` | Psychology summary + performance by emotion / confidence / discipline |

## Implementation
- `supabase/migrations/0011_risk_events.sql`: new table + enums + RLS.
- `apps/web/lib/risk/`: `engine.ts` (pure: consecutive losses,
  disciplined streak, day context, `evaluateTradeRisk`,
  `evaluatePlanVsActual`), `validation.ts` (Zod schemas),
  `queries.ts` (RLS-enforced reads), `actions.ts` (save rules /
  plan, resolve event, service-role `logRiskEvent`), `types.ts`.
- `apps/web/lib/trades/actions.ts`: `createTradeAction` now
  evaluates risk rules before inserting (critical = block +
  log; warning = log + save) and logs positive-streak
  milestones (3, then every 5) after a disciplined closed
  trade is saved. Logging is best-effort and never loses a trade.
- `apps/web/components/risk/`: `risk-rules-form.tsx`,
  `plan-form.tsx`, `resolve-event-form.tsx` (client wrapper —
  a plain form cannot take a `(prev, formData)` action).
- Header navigation now includes Risk, Plan, Psychology.

## Known limits (to fix in later phases)
- Risk checks run over at most the 500 most recent trades
  (same limit as Phases 3–4). Phase 12 pushes aggregation into
  the database if a journal grows past it.
- No live Supabase project wired into the app yet (keys not in
  env, migrations not applied to the live project) — Phase 13
  applies migration 0011 with the rest.
- No goal creation UI yet (Phase 6); no XP/level scoring yet
  (Phase 7) — the positive streak only logs an event.

## Tests
Vitest, 23 new tests (132 total, was 109):
`apps/web/lib/risk/engine.test.ts` (16: consecutive losses,
disciplined streak, day context, all five rule checks,
positive-streak milestones, plan-vs-actual incl. unmeasurable
rows) and `apps/web/lib/risk/validation.test.ts` (7: rules and
plan schemas, bounds, nulls).
Three type errors during development were fixed in-session
(`calcRiskAmount` returns `number | null`; a plain form cannot
take a `(prev, formData)` action; `PsychologyRow` has no
`label` field).

## Verification
- `npm test` — 132/132 pass
- `npm run typecheck` — pass (web + calc)
- `npm run lint` — pass
- `npm run build` (apps/web) — pass, 20 routes; `/risk` 118 kB,
  `/plan` 118 kB, `/psychology` 107 kB first load

## Phase 6 needs next
- Goals & discipline (spec §21–23, §30): goal creation UI and
  tracking, discipline engine (Day 1 reminder / Day 2 warning /
  Day 3 stronger reminder — supportive, never shaming),
  motivation library, in-app notifications. The risk engine's
  events and the plan's discipline data feed both.
- The dashboard's risk discipline section can then use real
  rule checks (Phase 5) instead of the SL/discipline proxies.
