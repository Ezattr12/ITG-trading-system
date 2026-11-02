# Task 5 — Competency-Progression Evaluation

Status: EVALUATION ONLY. This document assesses the existing
Levels / XP / Achievement system against the proposed 1–10
competency ladder. It builds nothing. The competency build
belongs to Tasks 22–23; this evaluation is their input.

Proposed ladder (product-owner proposal, not implemented):
Foundation, Technical Trader, Risk Manager, Strategy Operator,
Psychological Discipline, Consistency, Professional Trader,
Institutional Trader, Trading Researcher, ITG Master Trader.

All findings below are grounded in the code as of 2026-11-02.
File references are to `apps/web` unless a package is named.

---

## 1. What already satisfies the competency vision

The current system is not an XP ladder with a new coat of paint.
It is already a multi-dimensional competency score with XP as a
supporting signal — which is the architecture the 1–10 ladder
needs. Specifically:

**A real dimension engine, not a single metric.**
`lib/gamification/scoring.ts` scores eight dimensions 0–100
from stored trader data (`calcDimensionScores`, scoring.ts:99):
discipline, risk, journal consistency, goal completion,
psychology, strategy execution, consistency, performance.
Inputs are derived from the same analytics bundle the dashboard
uses (`dimensionInputsFromBundle`, scoring.ts:262), so the
level can never disagree with the trader's own statistics.

**Weights that encode the product's values.**
`DEFAULT_DIMENSION_WEIGHTS` (scoring.ts:32) weights discipline
and risk at 0.20 each and performance at only 0.05. A trader
who wins every trade but journals nothing and follows no risk
plan stays at the bottom — the engine already refuses to call
that competence.

**Honest measurement.**
A dimension with no data returns null and is excluded, with the
remaining weights renormalised (`calcLevelScore`,
scoring.ts:107–137). A trader with no measurable dimension gets
a null score, never a fabricated 0 (scoring.ts:108–122), and
the Levels page renders that state verbatim ("No level yet").
Consistency is measured only over weeks since the trader's
first closed trade, capped at the most recent 12
(`weeklyConsistencyPct`, scoring.ts:224). Scoring runs over at
most the 500 most recent closed trades (documented limit in
`lib/gamification/queries.ts`).

**Configurable thresholds and weights.**
Bands live in the `levels` table (seeded Bronze 0–39, Silver
40–59, Gold 60–79, Platinum 80+, migration
`0017_production_config_seed.sql`:39–50). Weights are read from
the first level row's `scoring_config` jsonb and parsed
defensively (`parseScoringConfig`, scoring.ts:52;
`scoreTrader`, scoring.ts:166). An admin can retune bands and
weights without a code change.

**Progress math already exists.**
`progressToNextLevel` (scoring.ts:189) returns the current and
next level, points to go, and band-relative progress percent.
It is band-count agnostic — it finds the next band by
`minScore` — so it survives a move from 4 bands to 10 without
modification. Dashboard and Profile already present this via
the shared `LevelRing` component (dashboard page, profile
page), fed by a live recomputation, never by the stored row
(`lib/analytics/queries.ts`:115–191, which documents why:
the stored `user_levels` row "only records the last
calculation and is stale until the next refresh").

**XP as a supporting signal — and only that.**
XP values live in one place (`XP_TABLE`,
`packages/calc/src/index.ts`:215: journal 10, daily goal 20,
backtest session 15, weekly review 30, risk discipline 25,
achievement 0 + the achievement row's own `xp_reward`). XP is
not an input to the score: `dimensionInputsFromBundle` reads
trades and goals only. Awards are idempotent per
(user, reason, source) and best-effort, so a retry can never
double-award and a failed award can never lose a trade
(`awardXp`, `lib/gamification/actions.ts`:63). Penalties exist
only as explicit, validated, negative transactions with a
written reason (`validatePenalty`, `lib/gamification/xp.ts`:102;
`logXpPenalty`, actions.ts:106). The ledger is append-only —
`xp_transactions` has no client INSERT policy (migration 0008);
writes go through the service role.

**Achievement evidence.**
Achievements are config rows whose `criteria` jsonb names one
of seven stat keys (`lib/gamification/types.ts`:126;
`lib/gamification/achievements.ts`:29). Evaluation is strict:
empty criteria never auto-award, an unknown key is never
treated as met, a non-number threshold fails, an unmeasurable
stat fails (`achievementCriteriaMet`, achievements.ts:97).
Unlocks are stored with timestamps (`user_achievements`), and
the stored level row keeps a per-dimension `score_breakdown`
(`ensureLevelStored`, actions.ts:170). `refreshGamification`
re-runs the whole evaluation after every event that can change
it — trade writes (`lib/trades/service.ts`:281), discipline
(`lib/discipline/service.ts`:313), reviews
(`lib/reviews/service.ts`:136), coach refresh
(`lib/coach/service.ts`:228), and page visits to /levels and
/achievements. This trigger coverage is what a background
assessment engine (Task 17/23) would otherwise have to build.

---

## 2. Gap analysis: 4 levels → 10 levels

### 2.1 The closed LevelName union is the hard boundary

`packages/calc/src/index.ts`:228 declares
`type LevelName = "Bronze" | "Silver" | "Gold" | "Platinum"`.
Because the type is closed, the ten proposed names cannot be
added by configuration alone. Consumers that would fail to
compile or silently misbehave:

- `packages/calc/src/index.ts`:231 — `LevelThreshold.name` is
  typed `LevelName`; `:244` — `calcLevelForScore` returns
  `LevelName`. `DEFAULT_LEVELS` (:237) carries the four bands
  as the fallback when the table is empty
  (`thresholdsFromLevels`, scoring.ts:147).
- `apps/web/lib/gamification/types.ts`:78 — `LevelRow.name` is
  `LevelName`, so a `levels` table with ten rows would not
  typecheck against the row type the queries return
  (`getLevels`, queries.ts:29 casts the rows directly).
- `apps/web/lib/gamification/types.ts`:70 —
  `LevelScoreResult.levelName: LevelName | null`.
- `apps/web/lib/gamification/scoring.ts`:159, 178–179 —
  `levelForScore` and `NextLevelProgress` propagate the union.

Loose consumers need no change: `components/profile/level-ring.tsx`
takes `levelName: string | null`, and notifications interpolate
the name as a string (levels page). The database itself stores
`levels.name` as plain text — the union is a TypeScript-only
constraint. Task 22's options are therefore: widen the union to
the ten names (a breaking change to a shared contract, with the
four current names retired), or demote `LevelName` to a string
alias and let the table be the source of truth (loses
compile-time safety). That choice is Task 22's to make with
full knowledge; this evaluation only establishes that it is
unavoidable.

### 2.2 Seed and migration needs

- The four bands are seeded in migration 0017 with
  `on conflict (slug) do nothing`. Ten bands need a new
  migration: ten new slugs, and a decision on the four existing
  rows (the seed's conflict handling means new rows can be
  added additively, but `user_levels.level_id` references and
  stored `score_breakdown` history point at the old rows).
- Every current trader's stored level would re-band on the next
  `refreshGamification` after the new seed lands. There is no
  migration path today that preserves "the level the trader was
  told they held" — `user_levels` is a single upserted row per
  user (migration 0008: `user_id ... unique`), overwritten on
  every refresh.
- `scoring_config` is read from `levels[0]` only
  (`scoreTrader`, scoring.ts:168). With ten rows, per-row
  configs would silently diverge — only the first row's weights
  would ever apply. Task 22 should treat the config as global
  (or enforce identical configs) rather than discover this in
  production.

### 2.3 Band-boundary proposal (proposal only — not implemented)

Preserving the existing anchors (40 / 60 / 80) matters: they
are the boundaries current traders were scored against, and
the seed descriptions are written around them. Splitting each
existing band keeps every current trader's broad standing
intact while adding the new titles:

| Proposed level | Score band | Maps from |
|---|---|---|
| Foundation | 0–19 | Bronze (lower) |
| Technical Trader | 20–39 | Bronze (upper) |
| Risk Manager | 40–49 | Silver (lower) |
| Strategy Operator | 50–59 | Silver (upper) |
| Psychological Discipline | 60–69 | Gold (lower) |
| Consistency | 70–79 | Gold (upper) |
| Professional Trader | 80–86 | Platinum |
| Institutional Trader | 87–92 | Platinum |
| Trading Researcher | 93–96 | Platinum |
| ITG Master Trader | 97–100 | Platinum |

The Platinum subdivision narrows toward the top deliberately:
the last points of a renormalised weighted score are the
hardest to earn and the easiest to lose, so the final titles
should be narrow. The alternative — pure deciles (0–9, 10–19,
…, 90–100) — is simpler but re-bands every existing trader
(a Silver at 45 would land mid-ladder under a different title)
and discards the 40/60/80 anchors for no compensating benefit.
Recommended: the anchor-preserving split above.

### 2.4 Per-level dimension evidence

The names in the upper ladder make dimension-specific claims
(Risk Manager, Psychological Discipline, Strategy Operator).
A single weighted scalar cannot evidence those claims: the
weighted mean lets dimensions compensate for each other, so a
trader could in principle reach a "Risk Manager" band with a
weak measured risk dimension carried by journaling and goals.

What exists today: `LevelScoreResult.dimensions` carries each
dimension's value and its renormalised weight, plus
`missingDimensions` (types.ts:64–76), and `ensureLevelStored`
persists the values as `score_breakdown`. That is enough to
*display* per-dimension evidence per level — the Levels page
already renders the breakdown table.

What does not exist: any per-dimension floor. Nothing in
`calcLevelScore` can express "this band additionally requires
risk ≥ X". Task 22 must add floor/gate semantics (most
naturally in `scoring_config`, alongside the weights) if the
titles are to mean what they say. Until then, the honest
presentation is the one the product already uses: level names
as bands of one overall score, with the breakdown shown.

### 2.5 What an assessment record (Task 23) needs that scoreTrader does not provide

`scoreTrader` is a pure, instantaneous calculation. An
assessment — a durable, auditable judgement that a trader met
a standard at a time, on evidence — needs more:

- **History.** `user_levels` holds one row per user, upserted
  on every refresh (actions.ts:196, `onConflict: "user_id"`;
  migration 0008 unique constraint). There is no record of past
  scores, band changes over time, or how long a level was held.
  An assessment engine needs an append-only assessment/level
  history table.
- **Reproducibility.** The stored `score_breakdown` records
  dimension values, but not the weights in force, the
  `scoring_config` version, which dimensions were measured vs
  missing at assessment time (the values alone cannot
  distinguish "measured 0" from "excluded" once renormalised
  weights are discarded), or the input window (trade count,
  consistency window). An assessment must snapshot: dimension
  values, the measured/missing set, the weights and thresholds
  applied, and the rule version.
- **Evidence references.** Nothing links a score to the rows
  that produced it (which trades, goals, reviews). XP awards
  already model this pattern (`source_ref_id` idempotency,
  actions.ts:75); assessments need the equivalent.
- **Stability over time.** Competency implies sustained
  performance. The score is a point-in-time value over a
  rolling window; nothing requires a band to be held for any
  duration, and nothing distinguishes a first crossing from a
  sustained level. Pass/hold semantics are Task 23 design work.
- **Floors and breadth gates.** Per §2.4, and one more:
  renormalisation means a trader measurable on a single
  dimension can score 100 on it and land in the top band. With
  four bands this is a theoretical edge; with a "ITG Master
  Trader" title it is a reputational one. An assessment needs
  a minimum measured-dimension breadth before the top bands
  can be awarded (see §4).

---

## 3. Invariants that must NOT change

These are load-bearing properties of the current engine. Any
Task 22–23 design that breaks one is a regression, whatever it
adds:

1. **Performance stays 5%.** The weight is set in
   `DEFAULT_DIMENSION_WEIGHTS` (scoring.ts:32) and in every
   seeded `scoring_config` (migration 0017). The Levels page
   lede states it publicly: "Performance is only 5% of the
   score." Raising it would contradict the product's stated
   position that level is process, not profit.
2. **Unmeasurable dimensions are excluded, never zeroed.**
   Null-exclusion with renormalisation (scoring.ts:107–137) is
   the honesty core of the system. Zero-filling would punish
   new traders for not having data and fabricate a measurement
   that was never made.
3. **No score without data.** A trader with no measurable
   dimension has a null score and sees "No level yet"
   (scoring.ts:108; levels page). No default, starter, or
   estimated score may be introduced.
4. **XP never becomes the level.** XP is an engagement signal
   (journaling, goals, reviews, discipline). It is not an input
   to `scoreTrader` today and must not become one: the moment
   XP buys level, the level stops evidencing competence.
   (Task 23's own rule: XP supports an assessment, it is never
   the only requirement.)
5. **No external accreditation claims.** The proposed titles —
   including "ITG Master Trader" — are internal ITG titles.
   Nothing in the level system, and nothing Task 24 later puts
   on a certificate, may imply government, university, or
   industry-body accreditation.
6. **The XP ledger stays append-only and explicit.** No silent
   XP removal; penalties only via `validatePenalty`-checked,
   reasoned, negative transactions (xp.ts:102). Achievement
   evaluation stays strict: unknown keys never met, empty
   criteria never awarded (achievements.ts:97).

---

## 4. Risks and genuinely-open decisions

**Finding F4 — achievement percentage criteria (OPEN, product
owner's decision; carried from the Phase 29 audit).**
Two seeded achievements use percentage criteria at 100:
"100% Weekly Journal" (`weekly_journal_pct: 100`, migration
0017:61) and "Monthly Consistency" (`monthly_journal_pct:
100`, migration 0017:65). The evaluator measures the *current,
partial* window: `journalPctInWindow` runs from the week's /
month's start to today (achievements.ts:149), so 100% can be
met mid-window — in the extreme, after a single journaled trade
on the first day of a week. Whether a partial-window 100%
should unlock these achievements, or whether the criteria
should require a completed window (or a minimum trade count),
is a product decision that remains open. This evaluation does
not change the behaviour; Tasks 22–23 must not silently inherit
a decision either way.

**Renormalisation breadth at ten bands (design requirement for
Task 22, not a new product decision).**
As §2.5 notes, renormalisation can place a narrowly-measured
trader in a top band. With ten bands and prestige titles, Task
22/23 should require a minimum breadth of measured dimensions
for the upper bands. The exact breadth is an engineering
parameter of the assessment design, derived from the existing
"no score without data" invariant — it does not need a new
product decision, but it must not be skipped.

**Surfacing discrepancy Task 22 must not inherit.**
The dashboard/progress totals come from the analytics bundle,
which sums *all* XP transactions (`lib/analytics/queries.ts`:115,
172). The gamification bundle overrides `xpTotal` with the sum
of the 100 most recent transactions only — `getXpTransactions`
defaults to `limit = 100` (queries.ts:66) and
`getGamificationBundle` sets `xpTotal: totalXp(xpTransactions)`
(queries.ts:157). For a trader with more than 100 XP
transactions, /levels and /achievements would show a lower
total than the dashboard, and the XP chart's final cumulative
point (all rows) would disagree with the stated total. No live
user is near the limit today (the verification account has 23
XP rows), so this is a latent correctness note for the parent
to schedule — not part of this task's presentation-only scope,
and not a product decision.

**Config governance.**
Weights and thresholds are admin-editable rows. Ten bands
multiply the surface for an accidental misconfiguration (a gap
or overlap in bands makes `calcLevelForScore` fall through to
the last band, `packages/calc/src/index.ts`:244). Task 22
should add band-contiguity validation wherever bands are
edited. Noted as a requirement, not built here.

**Naming honesty.**
"Trading Researcher" and "ITG Master Trader" imply research
output and mastery the current eight dimensions do not measure
(backtesting exists only as an XP action and an achievement
stat, not a scored dimension). Task 22 either maps these
titles to the anchor-preserving bands as overall-score titles
(the honest reading, per §2.4) or adds dimension floors that
evidence them. Presenting them as dimension specialisations
without floors would overstate what the system measures.

---

## Conclusion

The foundation is genuinely strong: a weighted eight-dimension
engine with honest null handling, configurable bands and
weights, idempotent append-only XP, strict achievement
evaluation, stored per-dimension breakdowns, and refresh
triggers already wired into every write path. Tasks 22–23 do
not need a new engine. They need (a) a type-level widening of
the level-name contract, (b) a ten-band seed on the preserved
40/60/80 anchors, (c) per-dimension floors and breadth gates so
the titles mean what they say, and (d) an append-only
assessment record with reproducibility snapshots. The one
product decision already open — Finding F4 — stays open and
untouched by this evaluation.
