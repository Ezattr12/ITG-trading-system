# Task 19 — Trading Plan Enforcement (automatic monitoring)

**One input → many automatic outputs.** The trader's plan was,
until this task, a form that nothing consulted: trades were
checked against the risk RULES at save time (Task 7), but the
PLAN — markets, sessions, preferred setups, risk per trade,
daily limits — was only ever compared after the fact by the
aggregate Plan-vs-actual table. This task makes the plan a
live contract: every saved trade is judged against it
automatically, breaches are recorded in a new append-only
`plan_events` table and notified, and the Task 17 background
pass re-judges stored trades so nothing depends on the
trader opening a page.

**Enforcement is OBSERVATIONAL: evaluate, log, notify —
never block a save.** The only blocking checks in the
product remain the risk rules' two CRITICALs (daily loss
limit, leverage). Whether the plan should ever block, and
how plan-vs-rules precedence resolves, is Task 20's
pre-trade gate decision — deliberately NOT settled here.

Status: **built and gated locally; migration 0019 APPLIED
to production by the builder (see §4) and live-verified;
awaiting parent deployment + the production verification
script in §8.** No production data rows were written:
`plan_events` is empty and test account A is untouched
(10 trades / 390 XP, re-verified after all work).

---

## 1. Audit

### 1a. The plan schema (migration 0005, `trading_plans`)

One active plan per trader (upsert-by-user in
`saveTradingPlanCore`). Every field, and what it can
honestly be checked against:

| Plan field | Type | Checked against | Evaluable? |
| --- | --- | --- | --- |
| `markets` | `text[]` | `trades.pair` (case-insensitive) | ✅ `market` |
| `sessions` | `trading_session[]` | `trades.session` | ✅ `session` — only when recorded (see §2) |
| `risk_per_trade_pct` | `numeric`, null | derived trade risk % (see §2) | ✅ `risk_per_trade` — only when derivable |
| `max_daily_loss` | `numeric`, null | day P&L of closed trades (`trades.pnl` by `closed_at` day) | ✅ `daily_loss_limit` |
| `max_daily_trades` | `integer`, null | count of trades opened per UTC day | ✅ `daily_trade_limit` |
| `preferred_setup_ids` | `uuid[]` | `trades.setup_id` | ✅ `setup` — only when recorded |
| `no_trade_conditions` | `text` | — | ❌ free text, no machine-readable counterpart |
| `psychology_rules` | `text` | — | ❌ free text |
| `schedule` | `jsonb {notes}` | — | ❌ free-text notes |
| `name`, `is_active`, `deleted_at` | — | row selection only | — |

The non-evaluable fields are the same ones
`evaluatePlanVsActual` already presents as "Not measurable
from trades" — enforcement does not invent a reading of
free text.

### 1b. Why `risk_events` was NOT reused

`risk_events` (migration 0011) looks similar but does not
honestly fit:

- Its `type` is a **closed Postgres enum of risk-rule
  terms** (`daily_loss_limit`, `leverage_limit`, …) whose
  semantics are tied to `risk_rules` rows (`risk_rule_id`
  FK). There is no value for market/session/setup, and
  adding plan values would make the Risk page — which reads
  `risk_events` as the trader's risk history — present
  plan breaches as risk events.
- It has **no dedupe keys**; enforcement needs one event
  per (trade, term) / (day, term), enforced structurally.
- Plan events reference the plan (`plan_id` exists on
  risk_events, but the row would still be a lie about its
  own kind).

Decision: a dedicated `plan_events` table mirroring the
risk_events shape and its append-only RLS (§4).

### 1c. Hook points (verified in code)

- `createTradeCore` (lib/trades/service.ts) is the single
  creation path shared by the web actions and the mobile
  API handlers. Risk evaluation already runs there; plan
  evaluation hooks in post-insert (§5). Corrections,
  edits and reviews do NOT re-evaluate — consistent with
  risk, which also evaluates only at creation.
- **Quick entry records no session and no setup** — the
  quick-trade schema has neither field; both land only via
  the advanced review (`saveAdvancedReviewCore`). So at
  save time the session/setup terms are not_evaluable by
  construction, and the background pass (§5) is what
  catches those breaches once a review records the fields.
- The Task 17 pass (`lib/intelligence/background.ts`) is
  the second hook: it already runs per user with a
  service-role client and structural idempotency.
- Before this task the Plan page showed the plan form and
  the aggregate Plan-vs-actual table only — no record of
  individual breaches existed anywhere.

---

## 2. The engine — `lib/plan/engine.ts`

Pure, like the risk engine: `evaluateTradeAgainstPlan(
trade, plan, dayContext)` returns one verdict per term,
always six, always in the same order:

```ts
interface PlanVerdict {
  term: "market" | "session" | "setup" | "risk_per_trade"
      | "daily_trade_limit" | "daily_loss_limit";
  status: "adhered" | "breached" | "not_evaluable";
  message: string;          // trader-facing, real figures only
  value: number | null;     // observed figure, when numeric
  limit: number | null;     // the plan's figure, when numeric
  reason: string | null;    // why not_evaluable
}
```

The trade input (`PlanTradeInput`) is prepared from the
stored row by the service layer. Its `riskPct` is derived
**exactly as createTradeCore derives it for the risk
engine**: `calcRiskAmount(entry, sl, positionSize)` /
`profiles.trading_capital` × 100. Trades carry no stored
risk figure; when the derivation is impossible (no
stop-loss, or no capital on the profile) `riskPct` is null
and the term is not_evaluable — the same honesty rule the
risk engine documents ("the engine cannot know the
trader's account size from a trade row alone").

### Per-term evaluability map

| Term | `breached` when | `not_evaluable` when |
| --- | --- | --- |
| `market` | pair ∉ plan markets (case-insensitive, the Plan-vs-actual convention) | plan lists no markets — an empty list means **unrestricted**, per the plan form (the field is optional) and `evaluatePlanVsActual` ("No markets set" → unmeasured), never a breach |
| `session` | recorded session ∉ plan sessions | plan restricts no sessions; OR the trade recorded no session (quick entry never does — a journaling gap, not a breach) |
| `setup` | recorded `setup_id` ∉ `preferred_setup_ids` | plan names no preferred setups; OR the trade recorded no setup |
| `risk_per_trade` | derived risk % > plan % | plan % unset; OR risk underivable (no SL / no capital) |
| `daily_trade_limit` | the trade's ordinal among its opened day's trades (cancelled/reversed excluded, ordered `opened_at, created_at, id`) exceeds `max_daily_trades` | plan limit unset; no day context supplied |
| `daily_loss_limit` | cumulative realised P&L of the trade's closed day, up to and including this trade (close order), ≤ −`max_daily_loss` | plan limit unset **or 0** (mirrors the risk engine, which skips a 0 limit); the trade has not closed; no day context |

Day-term event semantics: every trade past the line gets a
`breached` verdict (it is past the line), but the stored
EVENT is created once per (user, day, term) and attributed
to the trade that crossed the line — evaluation always
happens in chronological order (the save hook fires as
each trade is journaled; the pass iterates in opened
order) and the dedupe keeps the first, crossing, event.
A day whose P&L recovers above the line stops breaching
for later trades (their cumulative is back within the
limit), which the engine models naturally.

In the background pass, day terms are judged **only for
trades opened or closed today**: day enforcement is a
going-forward monitor (save-time judgement already covers
each trade's own day as it is recorded, including
backdated journals). Historical day aggregates remain the
Plan-vs-actual table's job. Trade-level terms are judged
for every open/closed trade in the pass — that catch-up is
what makes the Plan page's record complete, and dedupe
makes it a one-time cost.

---

## 3. What the trader sees

- **Notification per new breach event** (see §6 for the
  kind choice): title "Trading plan breach", body = the
  verdict's own message with its real figures.
- **Plan page — new "Plan adherence" section** below
  Plan-vs-actual: an honest explainer ("checks every saved
  trade… never blocks a trade… recorded once per day, for
  the trade that crossed the line"), then either an empty
  state (no plan / no breaches recorded yet) or a summary
  of breaches recorded in the last 30 days by term
  (stored events only — labelled as recorded breaches, not
  a recomputation) plus the 10 most recent events with
  term chips and messages. No violet (this is not AI).

---

## 4. Storage — migration 0019, `plan_events`

```sql
create type plan_event_term as enum
  ('market', 'session', 'setup', 'risk_per_trade',
   'daily_trade_limit', 'daily_loss_limit');

create table public.plan_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.trading_plans (id) on delete set null,
  trade_id uuid references public.trades (id) on delete set null,
  term plan_event_term not null,
  event_day date,               -- opened day (trade + count terms) / closed day (loss term)
  message text not null,
  details jsonb not null default '{}'::jsonb,   -- { value, limit }
  created_at timestamptz not null default now()
);
-- RLS enabled; ONE policy: select own (or admin). No client
-- insert/update/delete — append-only, service-role writes,
-- exactly the risk_events pattern.
create unique index plan_events_trade_term_uidx
  on public.plan_events (user_id, trade_id, term)
  where term in ('market', 'session', 'setup', 'risk_per_trade');
create unique index plan_events_day_term_uidx
  on public.plan_events (user_id, event_day, term)
  where term in ('daily_trade_limit', 'daily_loss_limit');
```

(Full file: `supabase/migrations/0019_plan_events.sql` —
the canonical copy; apply-checks are `if not exists` /
idempotent throughout.)

**Applied by the builder** via the Management API helper
(`~/workspace/.itg-helpers/sbmgmt.py`) on 2026-11-03,
preceded by a full logical snapshot
(`~/workspace/itg-backups/2026-11-03-0514`, outside git,
per the backup runbook). **Live verification after
applying (read-only):**

- public tables: **33** (was 32, +`plan_events`)
- `plan_events`: RLS **enabled**; policies: exactly 1 —
  `plan_events_select_own` (SELECT); no write policies
- indexes: pkey + `plan_events_user_idx` +
  `plan_events_term_idx` + both partial unique dedupe
  indexes — all present
- rows: **0** (nothing written to production by this task)

The RLS matrix test was updated for the new baseline
(33 tables; `plan_events` added to the append-only list) —
a spec-driven change: the migration is the spec.

---

## 5. Wiring

- **`lib/plan/service.ts`** — the write side.
  `logPlanEvent` mirrors `logRiskEvent` (service-role
  insert, existence check first, conflict/existing →
  "already logged", never throws). `logPlanVerdicts`
  persists breached verdicts and creates one notification
  per NEW event. `preparePlanTrade` /
  `buildPlanDayContext` build the engine's inputs from
  stored rows (deterministic order applied in code:
  `opened_at, created_at, id`).
- **Save hook** — `createTradeCore` post-insert (after the
  audit row + coach refresh, before returning):
  `await evaluatePlanForTrade(supabase, userId, data.id)`.
  Best-effort: the function catches everything and returns
  counts; a plan failure cannot fail or alter a save.
  One hook covers web + mobile (shared core).
- **Background pass** — `runPlanEnforcementForUser` is a
  new section of `runBackgroundPassForUser` (after the
  monthly notice, before insights): re-judges every
  open/closed trade (cancelled/reversed are never judged,
  by any path). The run summary, the
  `intelligence.background_run` audit details and the
  endpoint body gain `planEvents` / `planNotifications`.
  Two exact-shape assertions in `background.test.ts` were
  extended with the new fields (spec-driven shape change);
  no behavioural assertion changed.

---

## 6. Notification kind — `system`, deliberately

Plan breaches are **not** `risk_warning`: that kind's
producer contract is risk-engine events (the Task 17 pass
dedupes them by `related_entity_type = 'risk_event'`, and
the notifications page deep-links the kind to `/risk`). A
plan breach is neither a risk event nor a risk-page item.
`system` — the generic system-generated kind, a dead enum
value since the Task 9 audit — is the honest fit and now
has a real producer. Plan notifications carry
`related_entity_type = 'plan_event'` +
`related_entity_id = <event id>`, and the notifications
page deep-links exactly those to `/plan` (the risk_warning
→ /risk link is untouched).

---

## 7. Task 20 hand-off

The pre-trade gate should reuse, not reinvent:

- **`PlanVerdict`** (lib/plan/types.ts) — the per-term
  judgement shape, including `value`/`limit` and the
  `not_evaluable` reasons a gate must surface honestly
  (an unevaluable term is not a pass).
- **`PlanDayContext`** + `buildPlanDayContext`
  (lib/plan/service.ts) — the day aggregates, built from
  stored trades; a gate evaluating a CANDIDATE trade
  appends the candidate to these lists and re-runs the
  same pure engine.
- **`evaluateTradeAgainstPlan`** itself — pure and
  save-agnostic; the candidate's `PlanTradeInput` is built
  from the form values + the same risk derivation.
- The open decisions Task 20 owns: whether any plan term
  may block (today: none do), and plan-vs-rules precedence
  where fields duplicate (risk_per_trade_pct,
  max_daily_loss, max_daily_trades exist on both the plan
  and the rules; today rules alone can block, on their own
  values).

---

## 8. Production verification script (for the parent)

Prerequisites: deploy as usual (the migration is already
applied — §4). A baseline first:

```bash
# 0. Baseline (expect: plan_events 0; A trades 10, xp 390)
python3 ~/workspace/.itg-helpers/sbmgmt.py "select
  (select count(*) from plan_events) as pe,
  (select count(*) from trades where user_id='c4838c9d-babd-4d8c-9008-e0b1991aaa00') as a_trades,
  (select coalesce(sum(amount),0) from xp_transactions where user_id='c4838c9d-babd-4d8c-9008-e0b1991aaa00') as a_xp"

# 1. Unauthorised endpoint calls still 401 (unchanged from Task 17).

# 2. Authorised run → 200. EXACT prediction for run 1
#    (only test account A has an active plan — verified
#    2026-11-03; Ezat's account has trades but no plan, so
#    its plan section is a no-op):
#      planEvents: 4, planNotifications: 4
#    A's four events, all trade-level (no A trade touches
#    the run's day, so no day-term events):
#      session ×2 — trades 28a9f6eb… (London, 2026-10-28),
#                   a227846a… (London, 2026-10-29)
#      market  ×2 — trades 0f6b4ead… (EURUSD), d99354d9… (GBPUSD)
#    Other summary counts behave as in Task 17 (a November
#    run may add A's monthly notice etc. — independent of
#    this task's counts).
curl -s -X POST -H "Authorization: Bearer $INTELLIGENCE_CRON_SECRET" \
  https://itg-traderos.vercel.app/api/intelligence/run

# 3. Verify the stored rows match the prediction exactly.
python3 ~/workspace/.itg-helpers/sbmgmt.py "select term, trade_id, event_day
  from plan_events order by created_at"
python3 ~/workspace/.itg-helpers/sbmgmt.py "select type, related_entity_type, count(*)
  from notifications where type='system' group by 1, 2"

# 4. Idempotency: run again → planEvents: 0,
#    planNotifications: 0; the step-3 counts are unchanged.

# 5. Save-path check (throwaway account, parent's usual
#    pattern): give the throwaway an active plan listing
#    only XAUUSD, save one GBPUSD trade via the app →
#    exactly 1 plan_events row (market) + 1 system
#    notification; save a second GBPUSD trade → +1 event
#    (per-trade dedupe, not per-day); delete the throwaway.

# 6. Plan page as A: the adherence section lists the 4
#    events with term chips; the notifications page shows
#    4 "Trading plan breach" items linking to /plan.
#    A baseline re-check: 10 trades / 390 XP (unchanged —
#    plan events and notifications are new rows in their
#    own tables, by design).
```

---

## 9. Tests and gate

- **Engine** (`lib/plan/engine.test.ts`, 26 tests): every
  term's adhered / breached / not_evaluable edges —
  unrecorded setup/session, underivable risk figure, empty
  markets = unrestricted, zero daily-loss limit, day
  crossing vs earlier/later trades, P&L recovery above the
  line — plus the **account A fixture**: A's real plan and
  all 8 closed trades produce exactly 4 breaches
  (2 market, 2 session), with setup ×8, risk ×8 and
  session ×6 not_evaluable, pinned per trade.
- **Wiring** (`lib/plan/service.test.ts`, 9 tests): the
  save hook logs + notifies once and dedupes on repeat;
  no-plan and cancelled/reversed are never judged; a
  derivable risk breach logs `{value: 25, limit: 1}`; the
  pass logs today's trade-limit and loss crossings once
  each, attributed to the crossing trade; historical day
  terms are NOT backfilled; the **A fixture through the
  pass** (all 10 real trades incl. reversed + cancelled)
  yields exactly the 4 predicted events + 4 notifications
  on run 1 and zero on run 2.
- **Battery** (env sourced): Vitest **911/911** (baseline
  876 + 35 new; the 2 spec-driven updates: RLS matrix
  32→33 tables + plan_events append-only, background
  result shape +2 fields) · typecheck clean · lint 0
  errors (1 pre-existing dashboard `<img>` warning) ·
  production build clean · `security:check` passed
  (417 files) · Playwright e2e **36/36** (`CI=true`, repo
  root) · test-results cleaned.
- **Live DB**: migration verified (§4); A re-verified
  read-only after all runs: **10 trades / 390 XP**;
  `plan_events` still 0 rows in production.

## 10. Known limitations

- **Session/setup breaches surface only after a review
  records those fields** (quick entry doesn't collect
  them) and only when a save or a pass run evaluates the
  trade afterwards. A trade reviewed and never re-judged
  until the next daily pass is the worst case — the pass
  is the backstop, and its schedule registration remains
  Task 17's unverified item.
- **The pass judges at most the 500 most recent trades**
  (the shared `TRADE_LIST_FETCH_LIMIT`, Task 21's fix) —
  a trader with more history gets trade-level catch-up
  for the newest 500 only.
- **Plan edits are not retroactive events**: verdicts are
  judged against the plan as it stands at evaluation
  time, and stored events keep the figures from their
  moment (details `{value, limit}`); changing the plan
  does not rewrite stored events, and already-logged
  breaches are not un-logged if the plan later widens.
- **Day terms in the pass cover today only** (§2) — a
  crossing on a day with no save and no pass run is
  summarised by Plan-vs-actual but not event-logged.
