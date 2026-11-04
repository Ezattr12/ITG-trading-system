# Task 22 — Competency-Based Level System (the 1–10 expansion)

Status: IMPLEMENTED locally, full gate below. Production steps
(deploy + migration application) are the parent's, per §8.

The ladder grows from four bands (Bronze / Silver / Gold /
Platinum) to ten competency bands over the SAME eight-dimension
weighted score. The score computation is untouched — same
inputs, same weights, same null-exclusion with renormalisation.
Only the band mapping, the names, and band *resolution* change.
One genuine defect in band resolution was found by the audit
and fixed (§2); it had already mislabelled a real account in
production.

---

## 1. Audit — every consumer of the level contract

Method: repo-wide search for `LevelName`, the four legacy names,
`calcLevelForScore`, `DEFAULT_LEVELS`, and `level` references in
the gamification, analytics, coach, certificates and admin
trees, plus a read-only look at the live `levels` /
`user_levels` tables.

| Consumer | Location | Coupling | Task 22 change |
|---|---|---|---|
| Union, defaults, resolver | `packages/calc/src/index.ts:228` | Source of truth | Union widened to the ten names; `DEFAULT_LEVELS` replaced; resolver rewritten (§2) |
| Web gamification types | `apps/web/lib/gamification/types.ts:70,78` | `LevelName` import | None — flows from `@itg/calc` |
| Web scoring | `apps/web/lib/gamification/scoring.ts` | `thresholdsFromLevels` (DB rows → thresholds), `levelForScore`, `progressToNextLevel` | Comments only. `progressToNextLevel` was already band-count agnostic (next band by `minScore`) and needed no change |
| Web level reads | `apps/web/lib/gamification/queries.ts:29` `getLevels` | Rows ordered by `min_score`, cast to `LevelRow` | None |
| Analytics bundle | `apps/web/lib/analytics/queries.ts:85–203` | Own `levels` read; `levelName: string \| null` (loose) | Comment only |
| Stored level + notify | `apps/web/lib/gamification/service.ts` `ensureLevelStored`; call sites `lib/trades/service.ts`, `lib/discipline/service.ts`, `app/levels/page.tsx` | Compared stored row's level NAME vs live name; notified on ANY change | Band thresholds now returned too; all three sites use the new `isGenuineLevelUp` guard (§5) |
| Levels page | `apps/web/app/levels/page.tsx` | Ladder rendered from DB rows; current name in gold | Notify condition (above). Ladder is data-driven — ten rows render with no page change |
| Dashboard / Profile / Progress | `app/dashboard/page.tsx`, `app/profile/page.tsx`, `app/progress/page.tsx`, `components/profile/level-ring.tsx` | Render the name as a string; gold name treatment | Comments only. LevelRing truncates long names in its 76px slot (pre-existing behaviour; the full name renders beside the ring) |
| Admin levels | `app/admin/levels/page.tsx`, `lib/admin/actions.ts` `saveLevelThresholdAction`, `lib/admin/validation.ts` | Gold check hardcoded `name === "Platinum"`; header copy named the four bands; threshold edits validated per-row only | Gold check now targets `ITG Master Trader`; copy updated; whole-set contiguity validation added (§6) |
| Coach | `apps/web/lib/coach/*` | No level-name logic in code; the chat handler consumes the bundle's string fields | Test fixture rows updated to the ten bands |
| MCP server | `apps/mcp-server/src/intelligence.ts:987` | Reads the level name as a string from the DB | None |
| Certificates | `lib/certificates/*`, `app/certificates/*` | **No level references exist** | None |
| Achievements | `lib/gamification/achievements.ts` | Criteria are stat keys; no level coupling | None |
| Mobile vendored calc | `apps/mobile/vendor/itg-calc/` | Byte copy of `packages/calc/src`, produced by `apps/mobile/scripts/vendor-calc.mjs` (gitignored build artifact) | Regenerated with the vendor script; verified byte-identical to the updated source |
| Mobile band port | `apps/mobile/src/profile.ts:47` | Inlined `DEFAULT_LEVELS` + a port of `calcLevelForScore` / `progressToNextLevel` (names as strings) | Bands updated; resolver ported to the same min-threshold rule |
| Dev seed | `supabase/seed.sql` | Four rows | Updated to the ten rows (fresh dev databases only) |
| Production config | `levels` table (migration 0017 seed) | Four rows live | Migration 0020 (§4) — **authored, not applied** |

**How crossings were detected before this task:** three call
sites (trade save, goal completion, /levels visit) all ran the
same inline condition — stored name ≠ live name (and both
non-null) → create a `level_up` notification titled "Level up:
<current>". Direction was never checked: a downward crossing
produced a "Level up" notification too. §5 covers the fix.

---

## 2. The defect the audit found: fractional scores fell through to the top band

Scores are fractional — `calcLevelScore` rounds to one decimal.
The old `calcLevelForScore` matched a band by
`minScore <= score <= maxScore` with integer max edges
(39 / 59 / 79). Any score in the gaps — 39.x, 59.x, 79.x —
matched **no** band, and the function fell through to
`levels[levels.length - 1]` — the TOP band.

This is not theoretical. The verification account's stored row
(read-only SQL, 2026-11-04) is:

- `user_levels.score = 59.2`, `score_breakdown` = discipline
  100, risk 62.5, journal 37.5, goals 16, psychology 80,
  strategy 37.5, consistency 50, performance 87.5 (weighted
  sum 59.15 → 59.2 — the stored score is exactly what the
  unchanged scoring code produces from these inputs).
- The joined `levels.name` for its `level_id` is **Platinum** —
  written by `ensureLevelStored`, which resolves the level from
  the same bundle as the score. 59.2 fell through the 59–60 gap
  to the top band. Under the ladder's intent, 59.2 is Silver
  (40–59).

So today, production presents that account's level as the top
band at a score of 59.2. Two live `user_levels` rows exist;
both are re-pointed by migration 0020 (§4).

**Fix (in `@itg/calc`, ported to mobile):** band membership is
resolved by the `minScore` thresholds alone — the band with the
greatest `minScore` at or below the score. Bands are sorted
internally, so callers may pass rows in any order. There are no
gaps by construction, and `maxScore` becomes display/config
metadata (the levels page's "50–59" labels, the admin forms).
`progressToNextLevel` already treated `next.minScore` as the
band top, so its math is unchanged and now consistent with
resolution. Regression tests pin the gap scores: 39.5 →
Technical Trader, 59.2 → Strategy Operator, 79.9 →
Consistency, 96.5 → Trading Researcher.

Side benefit: admin threshold edits can no longer misassign a
trader by opening a max-edge gap (§6 adds set validation as
the second line of defence).

---

## 3. Band design — the Task 5 proposal, adopted verbatim

The Task 5 evaluation (§2.3 of
`docs/task-05-competency-evaluation.md`) recommended an
anchor-preserving split and argued against pure deciles. The
audit found no evidence against it, so Task 22 **follows it
exactly** — same boundaries, and the roadmap's proposed names
map one-to-one onto its rows:

| # | Level | Band | Anchor (previous band) |
|---|---|---|---|
| 1 | Foundation | 0–19 | Bronze (lower) |
| 2 | Technical Trader | 20–39 | Bronze (upper) |
| 3 | Risk Manager | 40–49 | Silver (lower) |
| 4 | Strategy Operator | 50–59 | Silver (upper) |
| 5 | Psychological Discipline | 60–69 | Gold (lower) |
| 6 | Consistency | 70–79 | Gold (upper) |
| 7 | Professional Trader | 80–86 | Platinum |
| 8 | Institutional Trader | 87–92 | Platinum |
| 9 | Trading Researcher | 93–96 | Platinum |
| 10 | ITG Master Trader | 97–100 | Platinum |

Why this preserves standing: the old anchors 40 / 60 / 80
remain band boundaries, and every new band lies wholly inside
one old band — a trader's broad standing (which old band they
were in) is recoverable from their new band at a glance. The
Platinum subdivision narrows toward the top, per the
evaluation: the last points of a renormalised weighted score
are the hardest to earn. The top band's `max_score` is NULL
(open), exactly as Platinum's was; the score is ≤ 100 by
construction, so the band is effectively 97–100.

**Naming honesty.** The names are presented the way the
product already presents levels: as bands of ONE overall
score, with the per-dimension breakdown rendered on the same
page. No copy claims a dimension specialisation the scalar
cannot evidence, and no copy claims any external
accreditation or professional qualification — the titles are
internal ITG progression names ("the highest ITG band …
mastered inside ITG TraderOS"). Per-dimension floors and a
minimum measured-dimension breadth for the upper bands are
assessment semantics and are handed to Task 23 (§9) — the
Task 5 evaluation itself places floors in the assessment
design (§2.4–2.5), and this task's mandate fixes the score
computation unchanged.

**Type decision (§2.1 of the evaluation posed the choice):**
the `LevelName` union is WIDENED to the ten names and the four
old names retired, keeping compile-time safety, rather than
demoted to a string alias. The database stores names as plain
text, so this is a code-side contract; every typed consumer
above was updated or verified loose (string) already.

**Insufficient evidence.** Unchanged and structural: no
measurable dimension → score null → level null → "No level
yet" on every surface. Nobody is placed at Foundation by
default; Foundation is a *measured* band (score 0–19 from real
data), not a floor state. No floor state was needed — every
surface already renders the null state honestly.

**Design-system check (gold).** The design skill reserves gold
for "levels, achievements and premium status", so the existing
gold treatments are within the sanction and unchanged: the
current level's name + "Current" chip on /levels, the level
name on Dashboard and Progress, and one change of target in
Admin, where gold marked the premium tier by the old name
(`Platinum`) and now marks `ITG Master Trader`. No violet
appears on any level surface (levels are not AI). No CSS was
added or changed; the `.itg2-level-scope` styles are not keyed
to level names (verified by search).

---

## 4. Migration 0020 — authored, NOT applied (parent's decision)

Levels are **stored configuration**, not pure computation: the
bands live in the `levels` table (admin-editable), the code
fallback applies only when the table is empty, and
`user_levels.level_id` references the band rows. A ten-band
ladder therefore genuinely requires a data migration; per the
task's hard limits it is authored here and **not applied** —
application (with the pre-migration snapshot, per the Task 19
pattern) is the parent's gated production step.

`supabase/migrations/0020_competency_levels.sql`:

1. **In-place updates** of the four existing rows (keyed by
   their current slugs) to the lower subdivision of each old
   band: bronze→Foundation 0–19, silver→Risk Manager 40–49,
   gold→Psychological Discipline 60–69, platinum→Professional
   Trader 80–86. Row ids are stable, so `user_levels`
   references stay valid throughout.
2. **Inserts** of the other six bands carrying the same
   canonical `scoring_config` jsonb the existing rows carry
   (the config is global by convention — `scoreTrader` reads
   the lowest band's row, which after this migration is
   Foundation, carrying the canonical weights; existing rows'
   configs are untouched).
3. **Re-point** of `user_levels.level_id` to the band
   containing each row's stored score under the new ladder
   (greatest `min_score` ≤ score — the code's own rule), so
   every stored row is self-consistent before new code runs.

Idempotent: updates key on the old slugs (no match on re-run),
inserts use ON CONFLICT (slug) DO NOTHING, the re-point is a
pure function of the stored score. New descriptions were
written for all ten rows in the same register as the 0017
seed, with no external-accreditation language.

Ordering note for the parent: apply 0020 **before or with**
the code deploy, never after a long gap — see §5 for why both
orders are safe, and §8 for the exact sequence.

---

## 5. Transition & notification analysis

Two independent safeguards make the rename silent for existing
users while keeping genuine crossings live:

**Safeguard 1 — the migration re-point (§4 step 3).** After
0020, a stored row names the band its stored score belongs to
under the new ladder. On the first refresh afterwards, the
previous name (read from that row) equals the live band
whenever the live score still sits in the same band — the
common case — so nothing fires. Residual drift (live score
moved since the stored row was written) behaves exactly as it
does today, because that drift predates the rename.

**Safeguard 2 — `isGenuineLevelUp` (code, all three call
sites).** A `level_up` notification now requires a genuine
upward crossing: both band names known to the CURRENT levels
table and the new band's `min_score` strictly greater than the
old one's. `ensureLevelStored` additionally returns both
bands' thresholds (the previous band's resolved by name
against the current table). Consequences:

- A pure rename can never notify: if the previous name is a
  retired band it is unknown to the current table → threshold
  null → no notification. If the previous row was renamed in
  place, the name resolves, and only a real upward band change
  notifies.
- Downward crossings no longer produce a "Level up:"
  notification (a pre-existing falsehood the narrower bands
  would have made more frequent).
- The verification account's specific drift is neutralised
  twice over: 0020 re-points its stored row from the
  fall-through "Platinum" to Strategy Operator (its stored
  59.2's band), and even un-migrated, "Platinum" is unknown to
  the new table, so no notification could fire.

Deploy-order safety: if code deploys BEFORE 0020 is applied,
the app reads the old four rows as data (names are strings at
runtime) and behaves as today, except gap scores stop falling
through (§2) and downgrade notifications stop. If 0020 is
applied BEFORE the code deploy, the old code reads ten rows:
band *display* updates immediately, and old max-edge
resolution would misassign only fractional scores in the new,
narrower gaps (they would fall through to ITG Master Trader)
until the new code lands — so the parent should apply 0020
and deploy in the same window, migration first.

First-render check for the parent (§8): after deploy +
migration, load /levels as the verification account and
confirm NO new `level_up` notification exists for it, while
its stored row names Strategy Operator.

---

## 6. Config governance — band-set validation (Task 5 §4)

`validateLevelBandSet` (`apps/web/lib/admin/validation.ts`)
validates a complete band set: non-empty, lowest band starts
at 0, min scores strictly increasing, only the top band may be
open-ended, no overlaps, no gaps (each band's max reaches to
within one point of the next band's min). `saveLevelThreshold
Action` now fetches the full ladder, applies the candidate
edit in memory, and rejects the save with the validator's
message before writing — a threshold edit can no longer
silently open a gap or overlap. The per-row zod schema is
unchanged. Unit tests cover the canonical ladder (in any row
order), a gap, an overlap, an open middle band, a non-zero
start, and the empty set.

---

## 7. Account A continuity

Fixture (production, read-only, 2026-11-04): stored score
**59.2** with the breakdown in §2; XP **390** (untouched by
this task — nothing here writes XP).

- **Score identical:** the scoring code is not modified (the
  diff touches only comments in `scoring.ts`). Pinned by test:
  feeding A's exact stored breakdown into `scoreTrader`
  reproduces **59.2** precisely (`scoring.test.ts`, "Account A
  continuity").
- **Band:** 59.2 lies in the old Silver range (40–59); its
  anchor-preserving subdivision is **Strategy Operator**
  (50–59). Pinned by the same test (`levelName` =
  "Strategy Operator") and by the calc gap regression
  (59.2 → Strategy Operator).
- **Before/after honesty:** A's *displayed* level before this
  task is the top band, but only via the §2 defect — the
  parent verification (§8) will observe "Platinum at 59.2"
  before, and "Strategy Operator at 59.2" after. The score —
  the thing that evidences standing — does not move.

---

## 8. Production verification script (for the parent)

Preconditions: snapshot the database first (Task 19 pattern).
Apply in one window: migration 0020, then the code deploy.

1. **Baseline (read-only SQL), before anything:**
   - `levels` = 4 rows (Bronze/Silver/Gold/Platinum).
   - A: `user_levels` score 59.2, joined level name Platinum;
     trades 10; XP sum 390; notifications count N (record it).
   - A's /levels SSR (session cookie): shows score 59.2 and
     the top-band name (the §2 defect, live).
2. **Apply migration 0020** via the Management API. Verify:
   `levels` = 10 rows in the §3 order with contiguous bands;
   every row's `scoring_config` identical; A's `user_levels`
   now joins to **Strategy Operator** with score still 59.2;
   the other `user_levels` row re-pointed to the band
   containing its stored score.
3. **Deploy** the Task 22 build; poll READY; resolve the
   production alias to the new deployment id.
4. **Smoke:** `prod-smoke-t10.py` and the levels smoke → ALL
   PASS. A's /levels SSR: score **59.2**, current level
   **Strategy Operator**, next level Psychological Discipline
   with 0.8 points to go, ladder lists all ten bands with
   Strategy Operator marked Current, breakdown table values
   unchanged (discipline 100, risk 62.5, journal 37.5, goals
   16, psychology 80, strategy 37.5, consistency 50,
   performance 87.5 — consistency is week-granular and may
   legitimately move if the week has rolled over; the score
   then moves honestly with it and the band must equal the
   band of the shown score).
5. **No transition notification:** A's notifications count is
   still N and no new `level_up` row exists for A. Visit
   /levels and /achievements as A (both call
   `refreshGamification`) and re-check — still none.
6. **Genuine crossing still fires (throwaway):** create a
   throwaway, seed it just below a band boundary with a stored
   `user_levels` row naming the lower band, then add the
   journal activity that pushes its live score across the
   boundary; confirm exactly one `level_up` notification
   naming the higher band. Delete the throwaway (cascade) and
   re-verify the user count and A's baseline (10 / 390 / N).
7. **Admin:** as an admin, open /admin/levels — ten rows, ITG
   Master Trader in gold. Attempt a gap edit (e.g. set Risk
   Manager min to 45) → rejected with the contiguity message
   and no audit row written; a valid edit (then revert) writes
   and audit-logs as before.
8. **Mobile spot check (optional, no rebuild required for this
   task):** the vendored calc and the band port are updated in
   source; the next APK build picks them up through the
   existing vendor step.

---

## 9. Task 23 hand-off — the assessment engine builds on this

What Task 23 inherits as DONE:

- Ten stable bands with slugs (`foundation` …
  `itg-master-trader`) as durable identifiers — assessments
  should reference bands by slug/id, never by display name.
- Gap-proof band resolution in ONE place (`@itg/calc`
  `calcLevelForScore`, min-threshold rule), mirrored in the
  mobile port — an assessment can resolve any score snapshot
  reproducibly.
- A transition-safe stored-level writer (`ensureLevelStored`)
  that already returns previous/current band + thresholds.
- Band-set integrity enforced at the only edit surface
  (admin), so the ladder an assessment reads is always a
  ladder.

What Task 23 must still build (from Task 5 §2.4–2.5, NOT in
Task 22's scope):

- **An append-only assessment record.** `user_levels` is one
  upserted row per user — no history, no held-duration, no
  reproducibility snapshot. The record must snapshot: dimension
  values, the measured/missing set, the weights and thresholds
  in force, the rule version, and evidence references (the XP
  ledger's `source_ref_id` pattern is the model).
- **Per-dimension floors + breadth gates.** A single weighted
  scalar lets dimensions compensate: nothing today stops a
  trader measurable on one dimension scoring 100 on it and
  landing in the top band. Before the prestige titles are
  *assessed* (as opposed to displayed as score bands), the
  engine needs floor semantics (naturally in `scoring_config`)
  and a minimum measured-dimension breadth for the upper
  bands.
- **Pass/hold semantics.** The score is point-in-time over a
  rolling window; nothing distinguishes a first crossing from
  a sustained level. Duration requirements are Task 23 design.
- **Finding F4 stays open** (achievement percentage criteria
  over partial windows) — a product decision, untouched here.

Deliberately NOT built in Task 22: dimension floors / breadth
gates (Task 23, above); any assessment or history table
(Task 23); certificate changes (none needed — certificates do
not reference levels); a mobile level surface change beyond
band parity (the port already renders whatever the stored
score + table say).

---

## 10. Gate results

Run 2026-11-04 (env sourced from `~/workspace/.itg-helpers/itg-env.sh`):

- **Vitest: 952/952 passed** (943 baseline + 9 new: calc anchor
  sweep + fractional-gap regressions, the Account A continuity
  test, 5 `isGenuineLevelUp` tests, the band-set validation
  test). Targeted re-run of all touched areas: 143/143.
- **Typecheck: clean** (web + `@itg/calc` workspaces).
- **Mobile typecheck: clean** (`apps/mobile` local `tsc
  --noEmit`, run directly to bypass the fault below).
- **Lint: 0 errors**, 1 warning — the pre-existing
  `@next/next/no-img-element` warning on the dashboard avatar
  (present since before Task 21; untouched by this task).
- **Production build: clean**, First Load JS shared 103 kB
  (unchanged from baseline).
- **security:check: passed** (428 files scanned).
- **A untouched:** the only production access was read-only
  SQL (the §2/§7 fixture values). A remains 10 trades / 390 XP;
  no production writes of any kind were made.
- **Playwright e2e: BLOCKED — infrastructure, not code.** One
  early attempt ran partially (25 tests passed before the
  window closed; the count is fault fallout, not a result).
  From ~07:43 EST the sandbox storage fault (the recurring one
  documented across Tasks 14/18/19) made every subsequent run
  die at the webServer's npm step: `EPERM: operation not
  permitted, write` in npm's `LogFiles.load`, 0-byte debug
  logs, exit 255 — while raw `dd`/node writes and the muse
  file service continued to work. A health-gated loop retried
  the canonical command 24 times over ~30 minutes (07:51–
  08:20 EST) plus spot checks; all failed identically.
  **Recovery for the parent:** re-run
  `CI=true npm run test:e2e` from the repo root once exec-side
  writes recover; expected 36/36 (the suite's only level
  contact is the /levels route's presence in
  `e2e/responsive.spec.ts`, and the app build it serves is the
  one verified above).
- **Local visual QA of /levels: BLOCKED — same fault.** The
  local production server (node-direct `next start`, bypassing
  npm) booted and the session mint succeeded, but Chromium
  died at launch with SIGTRAP, the fault's documented
  Playwright symptom. The QA script is retained at
  `~/workspace/.itg-helpers/qa-t22-levels.mjs` (account A,
  390/1280, overflow + 59.2 + gold-name probes) for the
  parent's recovery run; note it renders against the
  pre-migration four-row table — the ten-row ladder rendering
  is verified in production per §8 step 4 after 0020 lands.

Nothing in the blocked pair touches the code paths changed by
this task in a way the green gates don't already cover: the
full Vitest suite exercises every changed module, the
production build compiles every changed page, and the e2e
suite contains no level-name assertions.
