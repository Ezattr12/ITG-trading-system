# Task 25 — Trading Regime Intelligence (evidence-gated)

**A "regime" in this product is the market condition the
trader recorded on their own trades — nothing else.** ITG
TraderOS has no market-data feed, so any feature that claimed
to detect a live market regime (from prices, volatility, news
or external state) would be fabricating its evidence. This
task therefore builds the honest version of regime
intelligence: performance grouped by the trader's own
recorded market conditions, under the same materiality
standard as the pattern engine, with honest states for every
level of evidence — including the common case where the
trader has recorded no conditions at all.

What was actually missing was small. The pattern engine
already treated market condition as a first-class claim
dimension (Task 18); the conditions analysis already ranked
condition groups inside a mixed-dimension table. The real
gap was a dedicated per-condition **evidence view**: the
mixed "Best / worst conditions" card drops every group below
3 trades, mixes three dimensions in one ranking, shows no
win rate and no P&L share, and cannot distinguish "no
conditions recorded" from "recorded but small" — nor teach
the trader where a condition gets recorded. That view is
what this task adds, plus the tests that pin the pattern
engine's condition dimension for the first time.

## 1. The evidence-gating rationale

- The product holds exactly one regime-shaped signal:
  `trades.market_condition`, a label the trader chooses in a
  trade's advanced review (`advancedReviewSchema`,
  `lib/trades/validation.ts` — enum `trending`, `ranging`,
  `choppy`, `high_volatility`, `low_volatility`, `other`).
  Quick entry does not ask for it (`quickTradeSchema` has no
  such field), so coverage is partial by design and the
  coverage itself must be reported, not hidden.
- An unrecorded condition is **not** a regime. Groups form
  over recorded values only (the intelligence `groupBy`
  skips nulls); a journaling gap is reported as coverage
  ("Condition recorded on X of Y closed trades"), never
  dressed up as a group — the same recorded-values rule the
  pattern engine has applied since Task 18 (§3.6 of
  `docs/task-18-pattern-engine.md`).
- Claims and evidence stay separate, per the established
  layering: the pattern engine is the one place that turns
  group statistics into *claims* ("this condition stands
  out"); the intelligence analyses are the *reporting*
  layer. This task adds a reporting function and a view —
  it does not add a second claims path, a regime module, or
  any computation that duplicates `analyzePatterns`.
- What a real regime feed would change, and why it is not
  this task: with a read-only market-data integration
  (Task 27, deliberately last), trades could additionally be
  *tagged* with measured market state (e.g. realised
  volatility over the trade's life) and the same grouping
  machinery could report performance by measured regime
  alongside the trader's labels. That would be a new
  recorded field with a named source — not an inference
  drawn at read time — and it must never become a
  dependency for basic journaling. Until then, any
  "the market is currently trending" statement anywhere in
  this product would be invented data, and none exists.

## 2. Audit — capture and every consumer (file evidence)

**Capture**
- `trades.market_condition` column; written only via the
  review path: `advancedReviewSchema.marketCondition`
  (`lib/trades/validation.ts:131`), the Advanced review and
  Edit trade forms (`components/trades/advanced-review-form.tsx`,
  `components/trades/edit-trade-form.tsx` — "Market
  condition" select, `MARKET_CONDITION_LABELS`), persisted
  by `saveAdvancedReviewCore` (`lib/trades/service.ts`) and
  carried over corrections (service.ts:531). Quick entry
  records none (schema above). The trade detail page and the
  journal filters read it (`app/trades/[id]/page.tsx`,
  `lib/trades/filters.ts`).

**Consumers before this task**
- **Pattern engine** (`lib/intelligence/patterns.ts:184`):
  `market_condition` is one of the 12 pattern kinds,
  grouped via `groupBy(trades, t => t.marketCondition,
  CONDITION_LABELS)` under the uniform standard (account
  ≥5, group ≥3, gap ≥20 points or ≥50% of gross P&L
  movement; whole-population excluded; nulls never group).
  **Already first-class** — but no test had ever asserted a
  `market_condition` pattern (grep of patterns.test.ts
  before this task: zero `market_condition` assertions; the
  dimension was exercised only incidentally via fixtures).
- **Conditions analysis** (`analyzeConditions`,
  `analysis.ts`): market-condition groups ≥3 trades are
  mixed into one ranked list with session·direction and
  strategy·session rows; feeds the "Best / worst
  conditions" card, the improvement plan (priority 7) and
  the Coach's `trading_conditions` intent.
- **Coach** (`lib/coach/chat.ts` intent rules;
  `lib/intelligence/coach-answers.ts` `tradingConditionsAnswer`):
  the `trading_conditions` intent (`/condition/`, "when do
  i trade best", …) answers from `analyzeConditions` —
  market-condition rows are part of its evidence whenever a
  condition group reaches 3 trades.
- **Digests** (`lib/intelligence/queries.ts`
  `sliceAnalyses`): weekly/monthly digests run
  `analyzePatterns` over the period slice, so condition
  patterns flow through automatically (see §5).
- **Not consumers:** analytics descriptive breakdowns
  (`lib/analytics/analytics.ts` — strategy/session/
  direction/emotion only), reports (`lib/reports/reports.ts`
  — byStrategy/bySession/byEmotion only), MCP tools (they
  return `market_condition` as a trade field; no conditions
  tool exists). Descriptive per-period tables draw no
  conclusions and were left as they are, per the Task 18
  §5 precedent.

## 3. What was built

1. **`analyzeMarketConditions(trades)`** —
   `lib/intelligence/analysis.ts`, the reporting layer for
   the one dimension, built on the shared `groupBy`
   primitive (no new grouping implementation). Returns a
   `MarketConditionsAnalysis` (`lib/intelligence/types.ts`):
   `tradesCount`, `recordedTrades`, `unrecordedTrades`, and
   one `MarketConditionRow` per recorded condition (≥1
   trade, best P&L first) carrying the full `GroupStat`
   (trades, wins, win rate, total P&L, expectancy, …) plus:
   - `pnlShare` — |group P&L| as a share of the gross P&L
     movement (Σ|P&L|) across **all** closed trades, the
     same share the pattern engine's dominance test uses
     (null when gross movement is 0);
   - `comparable` — whether the group meets the ≥3-trade
     comparison minimum. Small groups are reported and
     flagged, never hidden and never concluded from.
   Status is `ok` when at least one condition is recorded,
   `insufficient_data` otherwise (the `analyzePsychology`
   convention). It draws no conclusions.
2. **Service surface** — `getMarketConditionsAnalysis` in
   `lib/intelligence/queries.ts`, and `IntelligenceOverview`
   gains a `marketConditions` field computed in the same
   data pass as every other analysis. Nothing is stored.
3. **"Market conditions" card** — `components/analytics/
   intelligence.tsx`, directly alongside (below) "Your
   patterns" in the Analytics intelligence grid, full width
   like the patterns card, existing `.itg2-*` classes only
   (`.itg2-card`, `.itg2-eyebrow`, `.itg2-section-title`,
   `.itg2-table`, `.itg2-chip-muted` — **no new CSS, no
   violet**; this is deterministic intelligence, not AI).
   The card states, in words, both the evidence rule
   ("ITG has no live market feed, so a condition here is
   always the label you recorded in a trade's review —
   never a live market reading") and the materiality
   standard (groups of 3+ compared with overall results;
   stands out in Your patterns at a ≥20-point win-rate gap
   or ≥ half of total P&L movement). Its states:
   - **Too few trades overall** (<5 closed): says so with
     the trader's actual count.
   - **No conditions recorded at all**: a teaching state —
     a condition is recorded in a trade's advanced review
     (the Market condition field, options named), quick
     entry does not ask for one, and once trades carry
     conditions the panel groups results condition by
     condition. No new form was invented; the copy points
     at the existing review field.
   - **Conditions recorded**: a coverage line ("Condition
     recorded on X of Y closed trades", plus "The rest
     carry no condition and form no group" when coverage
     is partial) and the evidence table — Condition /
     Trades / Win rate / P&L / Share of P&L movement —
     with sub-3 groups carrying a muted "Small sample"
     chip and a footnote: shown as recorded evidence, no
     comparison drawn.
4. **Tests pinning what already existed** — four new
   pattern-engine tests (§6) assert the `market_condition`
   kind end-to-end for the first time: win-rate-gap edge
   and drag with labels, P&L-dominance edge, group-of-2
   exclusion, and the recorded-values rule (profit
   concentrated in unrecorded trades produces no condition
   pattern and no patterns at all).

No migration. No schema, calculation, XP, RLS or Coach
change. `analyzeConditions`, the "Best / worst conditions"
card and the improvement plan are untouched — they answer
a different question (best/worst across dimensions), and
changing them was not needed to close this task's gap.

## 4. Coach — the decision

**No new intent, and no change to the existing one.**
Reasoning, recorded as required:

- A condition question ("how do I do in trending vs
  ranging conditions?", "when do I trade best?") already
  routes to the existing `trading_conditions` intent
  (patterns include `/condition/`), and that intent already
  answers through the existing evidence path —
  `analyzeConditions`, whose rows include recorded
  market-condition groups (≥3 trades) with P&L, win rate
  and expectancy. There was no missing wiring to close: the
  intent, its evidence and its insufficient-data honesty
  were verified in Task 15 and are unchanged.
- A dedicated pairwise intent ("trending *versus* ranging"
  as its own intent with its own answer shape) would be a
  taxonomy change to a verified intent set — a coach-task
  decision, not a silent extension (the Task 18 §5
  precedent: changing the Coach's gates/semantics is not a
  side effect of an intelligence task).
- Known nuance, stated plainly: the `trading_conditions`
  answer ranks the top measured groups across all three
  condition dimensions (session·direction and
  strategy·session rows can appear alongside
  market-condition rows), and it returns insufficient_data
  when no group of any dimension reaches 3 trades. The
  complete per-condition evidence — every recorded
  condition, any sample size, with coverage — is the new
  /analytics Market conditions card; the Coach answer
  remains the conversational summary it was verified as.
- Deterministic only: the narration seam was not touched
  (live narration still awaits Ezat's LLM key, Task 16).

## 5. Digests — verified flow-through, no second path

`sliceAnalyses` (`lib/intelligence/queries.ts`) computes
`patterns: analyzePatterns(slice, sliceLessons)` for both
digests, and `analyzePatterns` includes the
`market_condition` kind; `DigestCard`
(`components/analytics/intelligence.tsx`) renders any
pattern kind via `PATTERN_KIND_LABELS`, which already maps
`market_condition` → "Market condition". A qualifying
condition group inside a week or month therefore appears
in that period's digest with the same standard, labelled
"Market condition", with **no new code path** — verified
by reading the wiring end-to-end; the digest carries no
separate conditions field and none was added.

## 6. Tests

- `lib/intelligence/analysis.test.ts` (+3,
  `analyzeMarketConditions`): every recorded condition
  reported over the shared 12-trade fixture with
  hand-computed shares (gross 1610; Trending 5 trades
  +750, share 750/1610, comparable; Ranging 3, −370,
  comparable; Choppy 2 and High volatility 1 flagged
  non-comparable, not hidden); unrecorded trades never
  group and shares are computed against all trades' gross
  movement; insufficient status with zero recorded and with
  an empty journal.
- `lib/intelligence/patterns.test.ts` (+4, "market
  condition dimension (Task 25)"): gap edge + drag with
  labels and exact figures; dominance edge with the gap
  silenced by construction (share 1800/1950); group-of-2
  exclusion at 100% win rate; the unrecorded-concentration
  non-claim (patterns list entirely empty).
- `lib/intelligence/queries.test.ts` (+1,
  `getMarketConditionsAnalysis`): service scoping over the
  shared fixture — Trending 3 trades +410, share 410/910,
  comparable; Ranging 2 trades flagged; USER_B's +9999
  trade never appears; every trades query asserted scoped
  to the caller.
- No existing assertion was modified. Full battery in §8.

## 7. Account A — the honest state (read-only SQL)

A's live rows (read-only SQL, 2026-11-04; baseline
unchanged by this task: 10 trades / 390 XP / 23
notifications / 1 assessment / 0 certificates): 8 closed
trades — **7 with no market condition recorded**
(+2,502.50) and **1 recorded `trending`** (+1,200.00, a
win). The engine's honest conclusions for A:

- Pattern engine: **no** market-condition pattern — the
  single recorded group has 1 trade, below the group
  minimum of 3 (consistent with Task 18 §7: A's patterns
  remain exactly the XAUUSD dominance edge and the
  repeated mistake).
- New card (rendered and screenshot-verified locally at
  390px and 1280px, §8): coverage "Condition recorded on
  1 of 8 closed trades. The rest carry no condition and
  form no group."; one evidence row — Trending, 1 trade,
  win rate 100.0%, P&L +1,200.00, share 32.4% of gross
  movement (1,200 / 3,702.90) — flagged **Small sample**
  with the no-comparison footnote. Nothing else is claimed,
  and no group is invented for the 7 unrecorded trades.

## 8. Gate results (local, this build)

- **Vitest 1000/1000** (91 files; baseline 992 + 8 new —
  analysis 23, patterns 19, queries 11 in the intelligence
  suites; coach suites unchanged and passing).
- **Typecheck** clean (web + `@itg/calc`); **lint** 0
  errors (1 pre-existing dashboard `<img>` warning,
  unrelated); **production build** clean, First Load
  **103 kB unchanged**; **security:check passed** (441
  files); **Playwright e2e (CI=true, repo root) 36/36**.
- **Visual QA 22/22** (`~/workspace/.itg-helpers/
  qa-t25-regime.mjs`, local production build on :3100,
  account A session via cookie injection): the Market
  conditions card at 390px and 1280px — evidence-gating
  copy, standard in words, coverage line, the Trending
  small-sample row with its 32.4% share, the footnote, no
  invented groups, zero horizontal overflow at page level
  (the evidence table scrolls inside its own container at
  390px, the established convention). Screenshots eyeballed
  at both widths.
- **Rendered vs test-pinned, stated plainly:** A's real
  state (recorded-but-small) was rendered and verified at
  both widths. The populated multi-condition table (several
  comparable rows), the no-conditions teaching state and
  the <5-trades state could not be rendered from A's data —
  they are pinned by the analysis tests (which drive the
  card's exact state fields) and by the card's state logic
  reviewed against those fields.
- **A's baseline re-verified after all local work:**
  10 trades / 390 XP / 23 notifications / 1 assessment /
  0 certificates — unmoved.

## 9. Production verification script (for the parent)

Preconditions: none special — no migration in this task.
Deploy the tree, then:

1. Baseline (read-only SQL): A = 10 trades, XP sum 390,
   notifications 23, level_assessments 1, certificates 0;
   A's closed trades by `market_condition`: null ×7
   (+2,502.50), `trending` ×1 (+1,200.00).
2. Deploy; poll READY; resolve the alias to the new id.
3. Smokes: prod-smoke-t10.py and prod-smoke-levels.py →
   ALL PASS.
4. A's /analytics SSR (session cookie, in-memory mint):
   the "Market conditions" section present with the
   coverage line "Condition recorded on 1 of 8 closed
   trades", exactly one Trending evidence row with
   "32.4%", the Small sample flag and the footnote; no
   Ranging/Choppy rows; "Your patterns" unchanged (exactly
   the XAUUSD edge + the repeated mistake — no
   market-condition pattern).
5. Coach spot-check (deterministic): as A, the Coach's
   conditions answer behaves exactly as before this task
   (the intent was not modified) — no new audit shape;
   `coach.chat` rows still carry details of exactly
   {outcome, intent, narration}.
6. Re-verify A's baseline byte-identical to step 1.

## 10. Task 26 hand-off — Advanced Research / Backtesting Intelligence

- Audit first, as here: backtest sessions already exist as
  an XP-bearing activity (`backtest_session`, 15 XP in the
  shared XP table) — find the actual data model and any
  existing backtest surface before designing anything.
- The evidence-gating doctrine of this task applies with
  full force: a backtest/research claim may only be
  computed over data the system actually holds (the
  trader's recorded trades and any stored backtest
  sessions). There is no historical price series in this
  product, so "replaying" a strategy against market history
  is impossible without Task 27's read-only data — do not
  simulate one.
- The reusable machinery is the same: `IntelTrade` reads
  (`getIntelligenceData`), the grouping primitives, and the
  pattern materiality standard. Research outputs should
  cite their evidence population the way assessments and
  patterns do.
- Standing residuals not to conflate with Task 26: the
  Coach's pairwise trending-vs-ranging intent (§4) remains
  a possible future coach-taxonomy decision for Ezat; the
  Vercel cron registration question stays with Task 28.

## Known limitations / deliberately not built

- **No live regime detection** — by design and by mandate;
  see §1. Nothing in the product states what the market is
  doing now.
- **No changes to the Coach** (§4), to `analyzeConditions`
  or the Best/worst card, to reports or analytics
  descriptive tables, or to the mobile app (the mobile
  analytics surface consumes the same intelligence reads on
  its own schedule; no mobile change was in this task's
  scope).
- **Coverage is the ceiling**: with conditions recorded on
  a minority of trades (A: 1 of 8), the honest output is
  mostly a coverage story. The card is designed to make
  that visible and to teach the one-field fix (the review's
  Market condition) rather than to manufacture conclusions
  from the recorded minority.
