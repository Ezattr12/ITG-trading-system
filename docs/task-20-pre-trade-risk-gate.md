# Task 20 — Pre-Trade Risk Gate (READY / CAUTION / RULE VIOLATION)

**One input → one judgement before save.** Until this task,
the trader only learned a trade breached their plan or rules
AFTER saving it (Task 7's save-time risk check, Task 19's
observational plan logging). This task adds the pre-save
judgement: on the Add Trade page, a "Check pre-trade gate"
button judges the candidate trade against the active plan
and the active risk rules and returns READY, CAUTION, or
RULE VIOLATION — reusing the Task 19 plan verdicts and the
risk engine's severities, inventing no second judgement
vocabulary.

Status: **built and gated locally (Vitest 933/933,
typecheck/lint/build/security clean, Playwright e2e 36/36);
NO production writes made, NO git push, NO deployment —
the parent owns deploy, production verification, push,
records, and the Task 20 report.** No migration: the gate
is read-only and needs no storage.

---

## 1. Audit

### 1a. What already existed (verified in code, not assumed)

- **Plan engine** (`lib/plan/engine.ts`, Task 19): pure
  `evaluateTradeAgainstPlan(trade, plan, dayContext)` →
  six `PlanVerdict`s (market, session, setup,
  risk_per_trade, daily_trade_limit, daily_loss_limit),
  each adhered / breached / not_evaluable with a reason.
  `PlanDayContext` + `buildPlanDayContext`
  (`lib/plan/service.ts`) build the day aggregates from
  stored trades.
- **Risk engine** (`lib/risk/engine.ts`, Task 7): pure
  `evaluateTradeRisk(rules, candidate, day, streak)` →
  `RiskCheck`s with severity critical / warning /
  positive. Exactly two CRITICALs block a save in
  `createTradeCore` (`lib/trades/service.ts`): leverage
  above the maximum, and the daily loss limit. Everything
  else is a WARNING: the trade is still journaled and the
  breach is logged to `risk_events`. `risk_events` has
  exactly one writer path (the save-time check).
- **Save-time risk semantics** (the gate must predict
  these, so they were re-verified line by line):
  - The risk day context is TODAY (`utcDate(now)`), NOT
    the candidate's opened day — a backdated journal entry
    is risk-checked against today's loss limit.
  - The risk daily-loss check sees only trades ALREADY
    closed today (the candidate's own P&L is not yet in
    the day total); the risk daily-trade check counts
    trades ALREADY opened today (the candidate is not
    yet counted).
  - The plan day terms, by contrast, judge the trade's
    OWN opened/closed day INCLUDING the trade itself.
- **Quick entry records no session and no setup**
  (Task 19 §1c): the quick-trade schema has neither
  field; both land only via the advanced review. So at
  quick entry the session/setup plan terms are
  not_evaluable BY CONSTRUCTION.
- **No docs/task-07-*.md exists** in `docs/` (the parent
  brief anticipated this): the Task 7 source used here
  is the risk engine code + the Task 19 doc §7 + the
  Task 7 summary recorded in project memory. Nothing was
  invented to fill a doc gap.

### 1b. The two decisions Task 19 left open — decided here

#### Decision 1: NO plan term ever blocks a save.

**Decision: plan breaches are at most CAUTION. The gate
never refuses a save on plan grounds; only the rules'
two CRITICALs refuse, exactly as today.**

Reasoning, from audit evidence (not preference):

1. **Journal honesty (Task 7 doctrine).** A journal that
   refuses to record a breach hides the very behaviour it
   exists to show. Market/session/setup terms are
   discipline intent, not account safety; refusing to
   journal a real trade because it was off-plan would
   corrupt the financial record. Task 19 kept plan
   enforcement observational for the same reason, and
   nothing in the audit overturns that principle.
2. **A blocking plan gate is incoherent at quick entry.**
   Session/setup are unrecorded pre-save, so the gate
   cannot evaluate two of its six terms for the very
   form it sits on. Blocking on unevaluable terms is
   incoherent; blocking on only the evaluable subset
   would make the gate's strictness depend on which
   fields the form happens to collect.
3. **A gate that blocks must predict the save.** If the
   gate refused on plan grounds while `createTradeCore`
   would save, the gate would be a false refusal; the
   trader would learn to distrust it. Keeping exactly
   one blocking authority (the rules) makes RULE
   VIOLATION ⟺ save refusal, a prediction the tests
   pin.
4. **The plan still bites.** A plan breach surfaces as
   CAUTION before save, and Task 19's logging still
   records it after save. Warning-before plus
   recording-after is enforcement without record
   corruption.

Neither decision is flagged as undeterminable: both
follow from the Task 7 doctrine, the Task 19
observational principle, and the single-blocking-authority
requirement. The one thing that WOULD change Decision 1
is an explicit Ezat product decision to make plan limits
hard limits — that would be a product change to save
semantics, not a gate change, and it is noted as an open
product question in §7 rather than smuggled in here.

#### Decision 2: plan-vs-rules precedence — rules govern blocking, plan governs advice, neither masks the other.

**Decision: where a field exists on both the plan and
the rules (risk_per_trade_pct, max_daily_loss,
max_daily_trades), BOTH judgements are computed on
their OWN values and BOTH are shown, each labelled with
its source and figure.**

- The RULES' value decides RULE VIOLATION vs not.
- The PLAN's value decides CAUTION vs not.
- A plan adherence never rescues a rules violation
  (rules CRITICAL breached + plan adhered ⇒ still RULE
  VIOLATION).
- A stricter plan still warns when the rules pass
  (plan breached + rules adhered ⇒ CAUTION, with both
  figures visible — e.g. plan risk 1% breached at 1.5%
  while rules risk 2% passes).
- The alternative — "stricter value wins and blocks" —
  was considered and rejected: it would create two
  blocking authorities with no single source of truth,
  break the gate's save prediction, and let a plan edit
  silently change save refusals. The alternative
  "plan overrides rules" was rejected for the same
  reason, in the other direction.

---

## 2. What was built

### New module `lib/gate/` (no migration, no new table)

| File | Contents |
| --- | --- |
| `lib/gate/types.ts` | `GateLevel` (`ready` \| `caution` \| `rule_violation`), `GateResult` (level, `willBlockSave`, plan verdicts, risk checks, hasPlan/hasRules, summary), day-row shapes. Documents why the overall level is computed over EVALUATED terms only while unevaluable terms are never rendered as a pass. |
| `lib/gate/engine.ts` | Pure: `buildCandidatePlanDayContext` (the Task 19 hand-off literally — stored day rows + candidate, deterministic order opened_at/created_at/id and closed_at/created_at/id) and `composePreTradeGate` (CRITICAL breach ⇒ RULE VIOLATION; plan breach or WARNING breach ⇒ CAUTION; else READY; a `positive` milestone is never a breach). |
| `lib/gate/service.ts` | `evaluatePreTradeGateCore(supabase, userId, rawInput, now?)`. Validates with the quick-trade schema + optional session/setupId (the base schema carries refinements so it cannot be `.extend()`ed — the extras are validated separately, never ignored). Derives P&L/status via `computeTradeMetrics` and risk % via `calcRiskAmount`/capital — never accepted from the client. Plan verdicts via the Task 19 engine on the candidate day context; risk checks via `evaluateTradeRisk` on createTradeCore's exact save-time inputs (today's day context, recent closed trades, disciplined streak). **READ-ONLY: no insert/update/delete anywhere.** |
| `lib/gate/actions.ts` | `evaluatePreTradeGateAction(formData)` — thin session-auth + FormData adapter over the core, mirroring `parseQuickForm` so the gate judges exactly the values the save would judge. |
| `components/trades/pre-trade-gate.tsx` | Client panel: "Check pre-trade gate" button reads the enclosing form's values (never submits, never saves), renders the banner + plan rows + risk-rows + unchecked-terms note + level-specific guidance. Colours: green READY / amber CAUTION / red RULE VIOLATION. No violet (Coach-only). |

### Wiring (presentation only, save semantics untouched)

- `components/trades/quick-trade-form.tsx`: new opt-in
  `gateCheck` prop renders the panel. Only the Add Trade
  page passes it (`app/trades/new/page.tsx`); corrections
  are excluded — a correction re-journals by reversal and
  is not a new trade. `createTradeCore` is UNCHANGED:
  the gate previews the save, it does not alter it.
- No CSS added: the panel reuses existing `.itg2-*`
  classes and the emerald/amber/red utility patterns
  already used for form states, so `itg2.css` size and
  the 103 kB First Load baseline are unchanged.

### Deliberate asymmetries (documented in code, not bugs)

- Plan day terms judge the candidate's OWN day
  (including the candidate); risk checks judge TODAY
  (excluding the candidate) — each matching the
  semantics of the system it previews. The panel labels
  the risk section "today" so the difference is visible.
- A gate check that is followed by no save leaves zero
  trace: no plan_events, no risk_events, no
  notifications, no audit rows. Task 19's save hook and
  background pass remain the ONLY plan-event writers,
  and the save-time check remains the ONLY risk-event
  writer.

---

## 3. Tests and gate (local only — parent owns deploy)

- **Baseline before work: Vitest 911/911.**
- **New tests: 22** (`lib/gate/engine.test.ts` 13,
  `lib/gate/service.test.ts` 9, fake-Supabase harness
  following the Task 19 pattern). Coverage includes:
  every level; positive-streak non-breach; not_evaluable
  never moving the level while the summary names it;
  all three precedence cases (plan adhered + rules
  CRITICAL ⇒ VIOLATION; plan breached + rules adhered
  ⇒ CAUTION; both breached ⇒ VIOLATION with the plan
  breach still carried); candidate ordinal (6th trade of
  a 5-trade day); candidate P&L crossing the plan's
  daily loss but not the rules'; quick-entry session
  not_evaluable with READY still reachable; no-plan /
  no-rules READY; invalid input rejected with zero
  writes; gate writes nothing on any path.
- **Full battery (env sourced): Vitest 933/933**
  (911 + 22) · typecheck clean (both workspaces) · lint
  0 errors (1 pre-existing dashboard `<img>` warning)
  · production build clean (First Load shared 103 kB)
  · `security:check` passed (424 files) · Playwright
  e2e **36/36** (`CI=true`, repo root) · test-results
  cleaned.
- **No e2e spec was added** (the mandated count stays
  36/36): the panel is exercised through the core and
  engine tests plus the production build; interactive
  browser QA of the panel is owed to the parent's
  production verification (§5 step 4).
- **No production writes, no push, no deploy** by this
  builder, per the hard limits. Test account A and Ezat's
  account were never touched.

---

## 4. Files changed (working tree only — no commit by this builder)

Created: `apps/web/lib/gate/types.ts`,
`apps/web/lib/gate/engine.ts`,
`apps/web/lib/gate/service.ts`,
`apps/web/lib/gate/actions.ts`,
`apps/web/lib/gate/engine.test.ts`,
`apps/web/lib/gate/service.test.ts`,
`apps/web/components/trades/pre-trade-gate.tsx`,
`docs/task-20-pre-trade-risk-gate.md` (this file).

Modified: `apps/web/components/trades/quick-trade-form.tsx`
(`gateCheck` prop only),
`apps/web/app/trades/new/page.tsx` (passes `gateCheck`).

Unchanged on purpose: `lib/trades/service.ts`
(`createTradeCore`), `lib/plan/*`, `lib/risk/*`,
`itg2.css`, every migration, every e2e spec.

---

## 5. Production verification script (for the parent)

Prerequisites: deploy as usual (no migration for this
task). Baseline first — the gate writes nothing, so
every count below must be IDENTICAL before and after
each gate check:

```bash
# 0. Baseline (throwaway account T, created for this
#    verification and deleted afterwards; never Ezat's
#    account, never test account A):
#    T trades, XP, plan_events, risk_events, notifications
#    — record all five counts first.
python3 ~/workspace/.itg-helpers/sbmgmt.py "select
  (select count(*) from trades where user_id='<T>') as t_trades,
  (select count(*) from plan_events where user_id='<T>') as t_pe,
  (select count(*) from risk_events where user_id='<T>') as t_re,
  (select count(*) from notifications where user_id='<T>') as t_n"

# 1. Give T an active plan (markets XAUUSD only, risk 1%,
#    daily loss 200, daily trades 5) and active risk rules
#    (leverage max 10, risk 2%, daily loss 500, trades 5).
#    As T in the app, open /trades/new:
#    a. Fill XAUUSD, entry 2000, SL 1990, size 1, leverage 1
#       → Check gate → READY (session/setup listed as
#       could-not-be-checked; that is honest, not a fail).
#    b. Change pair to GBPUSD → Check gate → CAUTION,
#       Market row breached, willBlockSave false.
#    c. Change leverage to 50 → Check gate → RULE
#       VIOLATION, Leverage row breached. Then press Save
#       Trade → the save IS refused with the same leverage
#       message (this proves RULE VIOLATION ⟺ save refusal).
#    d. Re-check counts from step 0: ALL UNCHANGED — gate
#       checks wrote nothing, and the refused save wrote
#       only its risk_event (the pre-existing save-time
#       behaviour, not gate behaviour — note it separately).
# 2. Save one on-plan GBPUSD-free trade as T (XAUUSD, step
#    1a values) → Task 19 hook still logs nothing (on-plan)
#    and the trade saves normally; T trades +1 only.
# 3. /trades/new as a user with NO plan and NO rules →
#    Check gate → READY with "nothing to check against".
# 4. Visual QA (owed from this builder — no live browser
#    in this session): 320 / 390 / 768 / 1280 widths, zero
#    horizontal overflow on /trades/new with the gate panel
#    open; banner colours green/amber/red by level; no violet.
# 5. Delete throwaway T with full cascade; re-verify A
#    (10 trades / 390 XP) untouched.
```

---

## 6. Known limitations

- **Session/setup can only be gate-checked when they are
  supplied.** Quick entry has no such fields, so those
  two terms are always not_evaluable on the Add Trade
  form. A future review-time gate (advanced review form)
  can pass them through the existing optional
  session/setupId candidate fields — the core already
  accepts them — but that surface was not built here.
- **The gate judges the form's CURRENT values.** Editing
  a value after checking without re-checking leaves a
  stale panel; the panel does not auto-refresh (a
  deliberate choice: no save, no side effects, no
  keystroke-chatter queries — the trader re-presses
  Check). The Save button always re-runs the real
  save-time check, so a stale panel can never cause a
  wrong save outcome.
- **Backdated candidates:** risk rows judge TODAY (the
  save-time rule), plan day rows judge the candidate's
  own day. Both are labelled, but a trader journaling a
  backdated trade should read the risk section as
  "today", not as "that day".
- **Mobile has no gate surface yet.** The core
  (`evaluatePreTradeGateCore`) is adapter-ready for a
  mobile API handler, exactly as the trade cores were
  shared — that handler is future work, not built here.
- **The 500-trade fetch cap** (Task 21's fix) still binds
  the risk day context and the background pass; the
  plan day context is date-scoped and unaffected.

---

## 7. Task 21 hand-off

- Task 21 (per the roadmap: the shared 500-trade fetch
  cap) should note: the gate's risk day context flows
  through `getRiskDayContext`/`getRecentClosedTrades`
  (capped), while its plan day context is date-scoped
  (uncapped). Fixing the cap changes gate risk rows for
  traders over 500 trades — re-run the gate service
  tests after that change.
- **Open product question (Ezat-side, bundled — not a
  blocker):** should plan limits ever become hard
  limits? This task decided NO on audit evidence (§1b);
  reversing it would be a save-semantics product change
  (createTradeCore would gain a second blocking
  authority), not a gate tweak, and should be decided
  explicitly by Ezat if ever revisited.
- **Mobile gate surface** (API handler over
  `evaluatePreTradeGateCore` + Expo panel) is the
  natural Task 20 follow-up if Ezat wants parity; it
  needs no new engine work.
