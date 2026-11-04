# Task 23 — Level Assessment Engine (evidence-based passing)

Status: BUILDER COMPLETE, fully gated locally. No git, no
deploy, no production writes. Migration 0021 is AUTHORED
ONLY — the parent applies it to production after a fresh
snapshot, exactly as with 0020.

Governing hand-offs: docs/task-22-competency-levels.md §9 and
docs/task-05-competency-evaluation.md §2.4–2.5. Finding F4
remains open and untouched.

---

## 1. What existed (audit)

- The displayed level is a weighted scalar over eight
  dimensions (`lib/gamification/scoring.ts`), renormalised
  over measured dimensions, resolved to one of Task 22's ten
  bands by `@itg/calc calcLevelForScore` (gap-proof,
  min-threshold). `ensureLevelStored` upserts ONE row per
  user into `user_levels` — no history, no reproducibility
  snapshot beyond dimension values, no duration evidence.
- Nothing stopped a trader measured on a single dimension
  at 100 from displaying the top band: renormalisation makes
  the score 100, and no floor or breadth semantics existed
  anywhere (Task 5 §2.4–2.5, confirmed by re-reading the
  engine: `parseScoringConfig` reads weights only).
- The append-only pattern to mirror is migration 0019
  (`plan_events`) + `lib/plan/service.ts`: RLS SELECT-own
  only, no client write policies, writes server-side through
  the service-role client from a best-effort service that
  never blocks the triggering save. (The task brief's phrase
  "through the session client" does not match the shipped
  plan pattern — `logPlanEvent` writes via the service-role
  client because the table has no INSERT policy. Task 23
  mirrors the SHIPPED pattern: service-role writes from the
  assessment service, session-client reads under RLS. Any
  other choice would need an INSERT policy, which would
  break the append-only invariant the rls-matrix test pins.)
- Refresh triggers already converge on one function:
  `refreshGamification` (trade saves, discipline, reviews,
  coach, /levels and /achievements visits) — and the Task 17
  background pass is the scheduled cadence.

## 2. Design decisions

### 2.1 The record — `level_assessments` (migration 0021)

Append-only, one row per MATERIAL state change (§2.4).
Each row snapshots everything needed to reproduce the
verdict (Task 5 §2.5's list, verbatim):

- band identity three ways: `level_id` (FK, set-null on
  delete), `level_slug` (the durable identifier — bands are
  referenced by slug, never display name), `level_name`
  (display snapshot);
- `score`, `band_min_score`, `band_max_score` — the score
  and the thresholds IN FORCE (the levels table is
  admin-editable; history must not be rewritten by a later
  threshold edit);
- `dimension_values` (all eight, null = unmeasured),
  `measured_dimensions`, `missing_dimensions`;
- `weights` — the in-force weights (pre-renormalisation);
- `gates` — the standard applied {floor, min_measured,
  confirm_after_days};
- `conditions` — [{key, label, passed, detail}], the WHY in
  plain language, derived from this snapshot alone;
- `evidence` — the population the score was computed from
  {closed_trades, latest_closed_at, goals, goals_completed},
  the XP ledger's source_ref idea generalised (a score is
  produced by a population, not a single row, so the refs
  are population descriptors an auditor can re-derive);
- `standard_met` (breadth + floors, confirmation aside — a
  column because the NEXT assessment's confirmation rule
  reads it), `verdict` (enum pass|hold), `rule_version`
  (constant, currently 1), `state_signature` (§2.4).

RLS: exactly one policy, `level_assessments_select_own`
(user_id = auth.uid() OR is_admin()), no client write
policies — the rls-matrix test now pins the table in its
append-only list, and the table count moves 33 → 34.

### 2.2 Floors + breadth — the standard, and why these values

Configured in the levels' canonical `scoring_config` — the
same global config the weights live in, read from the
lowest level row and stamped IDENTICALLY on every row by
migration 0021 (the one-distinct-config invariant Task 22
verified is preserved; per-row divergent gate config would
have broken it and the levels[0] read convention). Shape:
`assessment.bands[<slug>] = { floor, min_measured,
confirm_after_days }`. The engine
(`parseAssessmentGate`) overrides per-field and falls back
per-field to band-derived defaults, so a missing or invalid
entry can never silently weaken a standard (the
`parseScoringConfig` philosophy). The seeded values ARE the
defaults (`defaultGateForBand`, keyed by band min score):

| Band (min) | Floor | Min measured | Confirm |
|---|---|---|---|
| Foundation (0), Technical Trader (20) | none | 3 | 7d |
| Risk Manager (40), Strategy Operator (50) | 20 | 4 | 7d |
| Psychological Discipline (60), Consistency (70) | 30 | 5 | 7d |
| Professional Trader (80) | 40 | 6 | 28d |
| Institutional Trader (87) | 50 | 7 | 28d |
| Trading Researcher (93) | 55 | 8 | 28d |
| ITG Master Trader (97) | 60 | 8 | 28d |

Rationale:

- FLOORS apply to MEASURED dimensions only. An unmeasured
  dimension is not a failed floor — it is governed by
  breadth. Conflating the two would punish new traders for
  dimensions they have not built yet and double-count the
  same gap.
- No floor below 40: Foundation / Technical Trader are
  habit-forming bands whose titles make no dimension claim
  (§2.4's honesty rule cuts both ways — floors exist so
  titles mean what they say, and these titles say nothing
  dimension-specific). A floor there would only punish
  beginners.
- From 40 the floor rises 20 → 60: at mid-ladder no measured
  dimension may sit in the bottom fifth; the top titles
  (93+) demand every measured dimension at 55–60 — a
  "mastery" claim with a dimension at 30 would be exactly
  the compensation failure §2.4 names.
- BREADTH rises 3 → 8: at least 3 measured dimensions for
  any assessment at all (a score can exist on 1); all eight
  for the two research/mastery titles, whose claim IS the
  full process. The headline edge is pinned in tests: one
  dimension at 100 displays ITG Master Trader but assesses
  as a breadth HOLD.

Governance: `validateAssessmentConfig` (admin validation)
checks any `assessment` block for shape/range (floor null
or 0–100, min_measured integer 1–8, confirm_after_days
integer 1–365, slug keys well-formed). It is wired into
`saveLevelThresholdAction` — the admin write path for this
table already loads every level row; it now also validates
each row's config and fails closed on a malformed standard.
The read-side parser's per-field fallback is the second
line of defence.

### 2.3 Pass / hold — first crossing vs sustained level

Verdicts: `pass` | `hold`. An assessment evaluates the
trader's CURRENT score band (never a band the score is not
in) against that band's standard:

1. breadth and floors all pass → the standard is MET;
2. a band is ASSESSED (pass) only when the standard is met
   at this assessment AND was already met at the trader's
   latest previous assessment of the SAME band, at least
   `confirm_after_days` earlier — or was already passed
   (a pass persists while the standard stays met);
3. anything else is a hold, and the stored conditions say
   which requirement is unmet and, for confirmation, the
   exact date from which a still-met standard counts as
   sustained.

Why confirmation is required at all: the score is a
point-in-time value over a rolling window; without a
duration rule, a single good day would mint a durable
"assessed" judgement — precisely the first-crossing vs
sustained distinction §2.5 demands. Why THIS duration rule:
the stored assessment history is the only duration evidence
that exists (`user_levels.calculated_at` is overwritten on
every refresh), so duration is measured in assessments and
the days between them — never inferred from data that is
not there. 7 days is one weekly cycle, the product's own
rhythm (weekly reviews, weekly consistency); 28 days for
the 80+ prestige bands is one monthly cycle, matching the
monthly report cadence. A previous assessment that did not
meet the standard (or was for a different band) resets the
chain — all pinned in tests, including Account A's chain.

Deliberately NOT done: no "revocation" of past passes (the
record is history; the CURRENT state is the latest row),
and no assessment notifications (the level_up notification
already marks display-band crossings; a second notification
kind for assessments was not in scope and the notifications
type set is closed). Certificates (Task 24) consume pass
rows — see §7.

### 2.4 Dedupe — material change, defined

A new row is written only when the engine's state
SIGNATURE changes. The signature covers: rule version, band
slug + thresholds, measured-dimension set, every condition
outcome (breadth, per-dimension floors, confirmation),
standard-met, verdict, the gates, and the weights. Raw
dimension values and the score are deliberately NOT in the
signature: drift that flips no outcome is not a material
change, and including values would write a row on almost
every refresh (the spam this rule exists to prevent). The
stored row snapshots the values as of its write; the
surface dates them ("Last assessed …"), so a slightly stale
value inside an unchanged outcome set is presented as what
it is — the last assessment's snapshot.

The one time-driven transition is captured by the same
rule: when the confirmation period elapses with the
standard still met, the confirmation OUTCOME flips, the
signature changes, and the pass is recorded — no separate
timer or cadence table needed.

Concurrency note (honest): dedupe is writer-checked
(read latest → compare → insert), like `logPlanEvent`
minus its structural unique index — "latest row only"
cannot be expressed as a unique index, and two concurrent
refreshes could in principle store two rows for one state
change. The consequence is benign (append-only history,
the surface reads the latest) and matches the best-effort
contract of every writer in this path.

### 2.5 Triggers — both, through one entry point

`runLevelAssessment(supabase, userId, getBundle?, now?)`
(lib/gamification/assessment-service.ts) is called from:

- `refreshGamification` — a third branch on the SAME shared
  bundle promise as achievements + the level store, so every
  existing refresh path (trade save, goal, review,
  discipline, coach, /levels, /achievements) assesses with
  zero extra bundle computations; and
- the Task 17 background pass — a new section after plan
  enforcement, counted as `assessments` in the per-user
  result, the run summary, the run-audit details and the run
  endpoint body. This is the confirmation cadence for
  traders who do nothing else that week.

Render behaviour is unchanged: the refresh already ran on
those paths; the assessment is one more best-effort,
never-throwing step inside it. The displayed score, band,
breakdown and notifications are byte-identical to Task 22
(pinned: the A visual QA below shows 59.2 / Strategy
Operator, and no code path from the assessment writes a
notification).

### 2.6 The /levels surface

One new section (after Score breakdown), all existing v2
classes, zero new CSS, no violet (deterministic, not AI):

- chip: Assessed (gold) / Holding (warning) / Not yet
  assessed (muted);
- one plain-language explainer of what an assessment is;
- when a row exists: "Last assessed <date> — <band>, score
  <score> at assessment" and the stored conditions as rows
  (label + the snapshot's own detail + Met / Not yet chip);
- when none exists: an honest not-yet state explaining that
  assessments run automatically on refresh.

The conditions are rendered FROM THE SNAPSHOT (the stored
jsonb), never recomputed on the page — what the trader sees
is the recorded judgement, which is the point of the
record.

## 3. Files

Created:
- apps/web/lib/gamification/assessment.ts — pure engine:
  gate defaults + config parsing, evaluateAssessment,
  signature, row types. Rule version constant = 1.
- apps/web/lib/gamification/assessment-service.ts —
  runLevelAssessment (dedupe, snapshot write).
- apps/web/lib/gamification/assessment.test.ts (19 tests)
- apps/web/lib/gamification/assessment-service.test.ts
  (6 tests)
- supabase/migrations/0021_level_assessments.sql — table,
  index, RLS, gate-standard stamping.
- docs/task-23-assessment-engine.md (this file)

Modified:
- apps/web/lib/gamification/service.ts — refreshGamification
  gains the assessment branch; its result gains
  `assessment: { written, verdict }` (additive).
- apps/web/lib/gamification/queries.ts —
  getLatestLevelAssessment (session-client read; returns
  null pre-migration, which the page renders honestly).
- apps/web/lib/intelligence/background.ts — assessment
  section + `assessments` counts (result, summary, audit
  details, endpoint body).
- apps/web/lib/intelligence/background.test.ts — the two
  exact-shape expectations gain `assessments` (spec-driven,
  the Task 19 planEvents pattern).
- apps/web/lib/admin/validation.ts —
  validateAssessmentConfig.
- apps/web/lib/admin/actions.ts — saveLevelThresholdAction
  loads scoring_config and validates it (fail closed).
- apps/web/lib/admin/validation.test.ts — validator cases.
- apps/web/lib/gamification/scoring.test.ts — regression:
  an `assessment` block in scoring_config leaves
  parseScoringConfig weights byte-identical.
- apps/web/lib/security/rls-matrix.test.ts — table count
  33 → 34; level_assessments pinned in the append-only list.
- apps/web/app/levels/page.tsx — assessment section + read.
- ~/workspace/.itg-helpers/qa-t23-assessment.mjs — visual
  QA script (outside git, helper).

NOT changed: @itg/calc (no vendoring impact), scoring.ts
(score computation), ensureLevelStored, XP, achievements
(F4 untouched), notifications, mobile (the assessment
surface is web; the record is written by shared server
paths the mobile writes also trigger via refreshGamification).

## 4. Gate results (local, this builder)

- Vitest: **979/979** (88 files). Baseline 952 + 27 new:
  19 engine + 6 service + 1 admin validator + 1 scoring
  regression. The rls-matrix count/list updates are
  spec-driven (new table), not assertion weakening — the
  matrix now also PINS level_assessments as client-read-only.
- Typecheck: clean (web + calc). Lint: 0 errors (1
  pre-existing dashboard `<img>` warning, not this task).
- Build: clean; First Load JS 103 kB — unchanged.
- security:check: passed (433 files).
- Playwright e2e (CI=true, repo root): **36/36**.
- Visual QA (local production build on :3100, A's session
  via cookie injection, script qa-t23-assessment.mjs):
  **16/16 at 390px and 1280px** — section renders, "Not yet
  assessed" state (the honest pre-migration state: the table
  does not exist in production yet, and both the writer and
  the read degrade to no-op/null without a crash), A still
  59.2 / Strategy Operator, no violet in the section, zero
  horizontal overflow. Screenshot eyeballed: v2 glass card,
  muted chip, explainer + honest copy render as designed.
  The populated Holding/Pass states could NOT be rendered
  locally (they need the migrated table) — they are pinned
  by the engine/service tests and by §5's production script.
  This limitation is stated, not papered over.
- Account A untouched (read-only SQL after all work):
  10 trades / 390 XP / stored score 59.2; levels still 10
  rows (0021 not applied).

## 5. Production verification script (for the parent)

Preconditions: fresh snapshot first (the Task 22 pattern:
~/workspace/itg-backups/snapshot.py). Apply in one window:
migration 0021, then the code deploy. NOTE: sbmgmt takes
single statements — apply 0021 statement by statement in
file order (enum do-block; create table; create index;
alter table RLS; drop policy; create policy; the levels
config update).

1. Baseline (read-only SQL), before anything:
   - A: trades 10, XP sum 390, user_levels score 59.2,
     notifications count N (record it), plan_events 4.
   - levels = 10 rows, ONE distinct scoring_config.
2. Apply migration 0021. Verify:
   - `level_assessments` exists, RLS enabled, exactly one
     policy (level_assessments_select_own, SELECT).
   - levels still ONE distinct scoring_config across all 10
     rows, now carrying `assessment.bands` with all ten
     slugs; weights keys unchanged.
   - A's /levels SSR (BEFORE any visit-triggered refresh —
     i.e. check the table first): level_assessments has 0
     rows for A.
3. Deploy; poll READY; resolve the alias to the new id.
4. Smokes: prod-smoke-t10.py and prod-smoke-levels.py →
   ALL PASS. (The levels smoke's expectations predate the
   assessment section; it asserts ladder/score facts that
   must be unchanged.)
5. A's first assessment: visit /levels as A (session
   cookie), then verify in SQL:
   - EXACTLY ONE level_assessments row for A: level_slug
     strategy-operator, score 59.2, verdict hold,
     standard_met false, rule_version 1, gates
     {floor 20, min_measured 4, confirm_after_days 7},
     dimension_values = A's eight (discipline 100, risk
     62.5, journal 37.5, goals 16, psychology 80, strategy
     37.5, consistency 50, performance 87.5 — consistency is
     week-granular and may legitimately differ if the week
     rolled over; then the row must match the LIVE bundle
     instead — check the page's breakdown against the row),
     evidence.closed_trades 8.
   - The failing conditions are exactly
     floor:goal_completion and confirmation.
   - The /levels SSR now shows "Holding" + the Goal
     completion floor condition with "Not yet".
   - Visit /levels and /achievements again: still ONE row
     (dedupe). A's notifications still N (assessments never
     notify), trades 10, XP 390, plan_events 4.
6. Background pass: POST /api/intelligence/run with the
   secret → 200; summary carries `assessments` (0 for A —
   already assessed, state unchanged); a second run → 0
   new rows of any kind.
7. Genuine pass proof (throwaway): create via Auth Admin
   API (+ profiles + onboarding rows), seed a state meeting
   a band standard with breadth (the cheapest honest route:
   closed trades + psychology giving ≥3 measured dimensions
   in Foundation, whose standard is breadth-only), stored
   user state as of a first assessment; confirm row 1 is a
   qualifying hold; then age it (the row's created_at is
   DB-stamped — for the proof, a second throwaway assessed
   via the pass with `now` is NOT possible against
   production time; instead verify the pass transition on
   the FIRST throwaway by direct SQL update of the seed
   row's created_at to 8 days ago — a test-data-only
   manipulation on a throwaway — then trigger a refresh
   (visit /levels as the throwaway) and confirm row 2 is
   verdict pass. Delete the throwaway (cascade) and
   re-verify user count + A's baseline.
   (If step 7's created_at manipulation is judged out of
   bounds, the fallback evidence is the service test's
   confirmation-chain test, which pins exactly this
   transition against the fake — but the live proof is
   preferred.)
8. Admin: as an admin, save a level threshold (then
   revert) — succeeds and audit-logs as before (the config
   validation passes on the seeded config).

## 6. Known limitations

- Confirmation depends on assessments actually running:
  refresh paths + the background pass. A trader who never
  returns is never confirmed — that is the honest semantics
  (no evidence of sustainment), not a defect.
- The stored snapshot's dimension values are as of the
  row's write; outcome-preserving drift does not rewrite
  (see §2.4). The surface dates the assessment.
- Dedupe is writer-checked, not index-backed (§2.4).
- The gate standards are code-defaulted + config-overridable
  but not yet admin-EDITABLE in the UI (the admin levels
  form edits thresholds only, as before); editing the
  standard today is a database/config change validated by
  validateAssessmentConfig on the next threshold save.

## 7. Task 24 hand-off — certificates build on assessed levels

- The durable evidence for "assessed at band B" is a
  `level_assessments` row with verdict = 'pass' and
  level_slug = B's slug. Certificates must reference the
  band by slug (+ the assessment row id as the evidence
  ref), never by display name alone — names are
  admin-editable display text.
- `getLatestLevelAssessment` (gamification/queries.ts) is
  the read; a "currently assessed" claim = latest row is a
  pass. A trader can hold a pass for a band they no longer
  display (score fell) — the row's created_at + the current
  band distinguish "was assessed" from "is assessed now";
  Task 24 must choose and document which its certificates
  assert.
- Certificates today do not reference levels at all
  (Task 22 audit) — any level-based certificate criterion
  is new surface, to be built on pass rows, not on the
  displayed band.
- Finding F4 (achievement percentage criteria) stays open;
  it is not a Task 24 input unless Ezat decides it.
