# Task 18 — Personal Trading Pattern Engine

**One evidence-based pattern layer.** The product already computed
group statistics in several places, but there was no single layer
that answers "which of my recurring patterns actually stand out?"
under one materiality standard. This task builds that layer —
`analyzePatterns` in `apps/web/lib/intelligence/patterns.ts` —
on the existing intelligence grouping primitives, surfaces it as
**Your patterns** on the Analytics page's Intelligence section,
and pins its behaviour with unit, service and real-account
fixture tests. Patterns describe recorded history only; nothing
in this task predicts a market, a price or a future outcome.

## 1. Audit — where pattern-like group analysis was computed

| Place | Grouping implementation | Gates / materiality | Scope |
| --- | --- | --- | --- |
| `lib/intelligence/analysis.ts` (Phase 23) | `groupBy`/`groupStat` over `IntelTrade` via `summarizeTrades` | `INTEL_MIN_TRADES` 5, `GROUP_MIN_TRADES` 3, `MATERIAL_WIN_RATE_GAP` 20 points (comparison statements need ≥3 on both sides + ≥20pt gap) | All closed trades; conditions, psychology, discipline, recurring, drawdown, risk, improvement plan |
| `lib/reports/reports.ts` | Its own `breakdown()` over `ReportTrade` (byStrategy/bySession/byEmotion) | None — descriptive rows; recommendations use their own rules (e.g. worst emotion needs ≥2 trades) | One report period |
| `lib/analytics/analytics.ts` | `breakdownBy` (+ strategy/session/direction wrappers, `psychologySummary`) over `AnalyticTrade` | None — descriptive tables | All closed trades (Analytics page) |
| `lib/coach/chat.ts` (Phase 22 intents) | Ranks `ReportSummary` rows via `rankedRows` | `PATTERN_MIN_TRADES` 5 overall, `ROW_MIN_TRADES` 2 per row, no gap requirement | Weekly / last-30 windows |
| `lib/coach/insights.ts` | `bestRow`/`worstRow` over `ReportSummary` rows | `COACH_MIN_TRADES` 3 in the week, rows ≥2 | One week; stored as `ai_insights` snapshots |
| `lib/intelligence/coach-answers.ts` (Phase 23 intents) | Consumes `analysis.ts` analyses | The intelligence gates above | All closed trades |

**Verdict: there was no single pattern engine.** Three separate
grouping implementations existed (intelligence `groupBy`,
analytics `breakdownBy`, reports `breakdown`) and three different
materiality regimes (≥3 + 20pt gap; ≥2 per row; none). The
intelligence primitives are the richest and the only ones with a
materiality standard, so the pattern engine is built on them —
see §5 for why the other implementations were deliberately left
as they are.

## 2. The engine

`analyzePatterns(trades, lessons)` — pure, no I/O, in
`apps/web/lib/intelligence/patterns.ts`. Input is the trader's
closed trades as `IntelTrade[]` plus their lessons, exactly as
`getIntelligenceData` assembles them (that read filters
`status = 'closed'`, so reversed and cancelled trades never
reach the engine; a service test pins this). Output is a
`PatternAnalysis`:

- `baseline` — the trader's overall figures from
  `summarizeTrades`: trades, wins, win rate, total P&L.
- `patterns` — `TradingPattern[]`, strongest first (display
  ordering only): `{ kind, key, label, direction, basis,
  trades, wins, losses, winRate, baselineWinRate, winRateGap,
  totalPnl, avgPnl, pnlShare, occurrences }`.

It reuses the now-exported `groupBy` / `groupStat` /
`CONFIDENCE_BANDS` / label maps from `analysis.ts` — the
grouping math is the intelligence module's, not a fourth copy.
One additive field supports it: `RecurringMistake.wins`
(linked closed trades with positive P&L), computed inside
`analyzeRecurring`; no existing field or behaviour changed.

Service surface: `getPatternAnalysis(supabase, userId)` in
`lib/intelligence/queries.ts`, and `IntelligenceOverview` gains
a `patterns` field computed in the same data pass as the other
analyses. Nothing derived is stored — `ai_insights` remains
the only snapshot store.

## 3. The materiality standard (uniform, and visible on the page)

1. **Account gate:** fewer than 5 closed trades
   (`INTEL_MIN_TRADES`) → `status: "insufficient_data"`, no
   patterns; the baseline is still reported.
2. **Group gate:** a group needs ≥3 closed trades
   (`GROUP_MIN_TRADES`). A group of 2 never surfaces, even at
   a 100% win rate (test-pinned).
3. **Significance — win-rate gap:** the group's win rate beats
   or trails the trader's overall win rate by ≥20 points
   (`MATERIAL_WIN_RATE_GAP`). Direction: above → `edge`,
   below → `drag`; basis `win_rate_gap`.
4. **Significance — P&L dominance:** otherwise, a group whose
   |total P&L| is at least `PATTERN_DOMINANCE_SHARE` (0.5) of
   the gross P&L movement (Σ|P&L| across all closed trades)
   also surfaces; basis `pnl_dominance`, direction from the
   sign of its P&L. When both tests pass, the gap is the
   headline basis (a rate is the stronger claim than a share).
5. **Whole-population rule:** a group covering every closed
   trade is the baseline itself and is never a pattern.
6. **Recorded values only:** groups form over recorded values
   (the intelligence `groupBy` skips nulls). A trade with no
   strategy recorded joins no strategy group. The alternative
   — calling "no strategy recorded" an edge when the
   unrecorded trades happen to hold the profit — would dress
   a journaling gap up as a trading pattern; coverage is
   already measured honestly by the discipline analysis
   (journal completion, stop-loss rate). §6 shows the
   concrete consequence for test account A.
7. **Stop-loss split is gap-only:** the with/without
   stop-loss split is two-way, so one side holding most of
   the P&L is arithmetic, not a pattern; it qualifies on the
   win-rate gap alone (test-pinned both ways).
8. **Repeated mistakes** follow the established recurrence
   convention, not the group-of-3 rule:
   `analyzeRecurring` surfaces a lesson text recorded ≥2
   times; the pattern carries occurrences, distinct linked
   closed trades, their wins/losses and summed stored P&L
   impact. Direction `recurring`, basis `recurrence`.

## 4. Pattern types — supported vs not supported

Supported (all from stored fields on closed trades/lessons):
strategy, session, direction, pair, setup, market condition,
emotion, confidence band (the Phase 23 bands 1–2 / 3 / 4–5),
session·direction, strategy·session, stop-loss split,
repeated mistake.

Not supported, and why:

- **Time-of-day (hour buckets):** `opened_at` is stored, so
  hours are derivable — but the product's recorded time
  dimension is the session field, no hour-bucketing
  convention has ever been defined, and under the inherited
  500-trade read ceiling the buckets would be noise.
  Deliberately not surfaced in v1.
- **Holding-duration patterns:** `duration_seconds` exists on
  the trade row but is not part of `IntelTrade` and has never
  been analysed anywhere in the product; adding it is a
  separate, deliberate step, not a silent extension.
- **Market-regime / price-based patterns** (e.g. "you lose
  when gold is volatile in the market sense"): the product
  has no market-data feed — the stored `market_condition` is
  the trader's own label and is supported as such; anything
  beyond it would be invented data.
- **Streak/sequence patterns** ("you lose after a win"):
  order-dependent claims need a sequence methodology the
  product has never defined; the risk analysis already
  reports streaks descriptively without calling them
  patterns.

## 5. Consumers — what was consolidated, what was left, and why

- **Consolidated:** the pattern engine is the one place that
  turns group statistics into *pattern claims*. It shares the
  intelligence grouping primitives rather than adding a
  fourth grouping implementation.
- **Left — reports `breakdown()` and analytics
  `breakdownBy`:** both render descriptive per-period /
  per-page tables with no conclusions drawn; gating them
  would change report figures and page content, which this
  task forbids without equivalence proof. They are tables,
  not pattern claims.
- **Left — coach chat intents (`ROW_MIN_TRADES` 2):** their
  semantics are conversational and windowed (current week,
  last 30 trades); a "best strategy" answer with its
  small-sample caveats is a different product behaviour from
  an all-time pattern claim. Changing the coach's gates is a
  coach-task decision, not a silent refactor.
- **Left — coach weekly insights (`generateCoachInsights`):**
  weekly snapshots with their own ≥2-row rules, stored in
  `ai_insights`; untouched.
- **Left — intelligence analyses:** they remain the group
  *reporting* layer (tables and gated comparison
  statements); the pattern engine sits on top of the same
  primitives for the *claims* layer.

## 6. Surface

Analytics page → Intelligence section → **Your patterns**
card (first in the section grid, full width on wide screens),
built from the existing `.itg2-*` system (`.itg2-card`,
`.itg2-eyebrow`, `.itg2-section-title`, chips:
`itg2-chip-profit` for Edge, `itg2-chip-loss` for Drag,
`itg2-chip-warning` for Repeats — no violet; this is
deterministic intelligence, not AI output). The card states
the materiality standard in plain language. Each pattern
shows its label, kind, direction chip and its evidence:
trades, win rate versus the trader's overall win rate, total
P&L (plus its share of total P&L movement when dominance is
the basis); a repeated mistake shows its occurrence count
and the linked trades' summed P&L.

Empty states are honest: below 5 closed trades the card says
so with the trader's actual count; at/above 5 with no
qualifying group it says no group stands out yet and that
results are spread evenly — it never fills the space with
sub-threshold groups.

## 7. Test account A — what the engine honestly finds

A's live rows (read-only SQL, 2026-11-02; unchanged by this
task: 10 trade rows, 390 XP): 8 closed trades, 7W/1L,
win rate 87.5%, total P&L +3702.50, gross movement 3702.90.
A fixture test in `patterns.test.ts` encodes these exact
rows. The engine returns **exactly two patterns**:

1. **Pair · XAUUSD — Edge (P&L dominance).** 6 trades, 6
   wins, 100% win rate, total +3702.20 = 99.98% of A's gross
   P&L movement. The win-rate gap is only +12.5 points, so
   this surfaces on dominance, not the gap.
2. **Repeated mistake · "M2P23 verification: entered before
   confirmation" — Repeats (recurrence).** Recorded 3 times,
   linked to 3 closed trades (+1000.00, +1.20, +0.50;
   impact +1001.70, 0 losses).

And what A does **not** qualify for, by the same standard:
BOS strategy (3 trades at 100% vs 87.5% baseline = +12.5
points — below the 20-point standard); London session (only
2 trades — below the group minimum); calm emotion (1 trade);
Long direction (all 8 trades — the baseline itself); the
stop-loss split (gaps of −7.5 / +12.5 points — below
standard).

One deliberate non-claim deserves stating plainly: A's
profit is concentrated in trades with **no strategy
recorded** (5 trades, +3700.30). Under the recorded-values
rule (§3.6) the engine does not call that a strategy
pattern — it is a recording-coverage fact, already visible
in A's journal-completion figures — rather than evidence
about a strategy A actually traded.

## 8. Tests and gate

- `lib/intelligence/patterns.test.ts` (15 tests): account
  gate at 4 trades; group-of-2 exclusion at 100% win rate;
  ok-with-zero-patterns state; exact baseline math; gap
  edge + drag with a full-object evidence assertion;
  whole-population exclusion; recorded-only grouping;
  dominance edge and drag (share hand-computed); stop-loss
  split gap-only (share-alone does not fire, gap does);
  repeated-mistake recurrence incl. the unlinked case; the
  account-A fixture (exactly the two patterns of §7, plus
  explicit non-qualification assertions).
- `lib/intelligence/queries.test.ts` (+2 tests):
  `getPatternAnalysis` is scoped to the caller (user B's
  +9999 trade never appears; baseline −90 over the 7-trade
  fixture), and reversed/cancelled rows added to the fixture
  change nothing — the closed-only contract is enforced by
  the `getIntelligenceData` read the engine consumes.
- No existing assertion was modified; `analysis.test.ts`,
  `coach-answers.test.ts` and the reports/coach suites pass
  unchanged against the additive `groupBy`/`groupStat`
  exports and the additive `RecurringMistake.wins` field.
- Full battery and visual verification: see the task report
  (Vitest / typecheck / lint / build / security / e2e counts
  and the 390px + 1280px checks of the new card as account A).

## 9. Hand-off

Task 21 (weekly/monthly intelligence) should consume this
engine for its pattern content — one line: digests already
slice `IntelTrade[]` by period, and `analyzePatterns` runs
over any such slice unchanged.

## Known limitations

- Intelligence reads are capped at the 500 most recent
  closed trades (`TRADE_LIST_FETCH_LIMIT`) — the engine
  inherits the ceiling every other intelligence analysis
  already has; patterns over a >500-trade journal would
  cover the most recent 500. Fixing the ceiling is the
  standing Task 21 figure-integrity item, not this task.
- Win-rate gap uses the overall baseline including the
  group itself (the codebase's established comparison
  basis); with very large groups this dilutes the gap,
  which errs conservative — fewer claims, not more.
