# Phase 8 — Certificates & Reports

Status: implemented locally, tested. **Supabase project
ITG-trading-system now exists** (per the parent agent's brief)
but migrations have NOT been applied to it and its keys are NOT
in the app env yet — the pages are real and complete, but they
show honest empty states until migrations are applied and env
vars are set. No demo trades, goals, XP, P&L or certificates.
Not deployed, not committed to GitHub (GitHub App push still
fails 403 — parent agent's blocker, unchanged).

## No new migration

All tables already existed from Phase 1 (migration 0009:
`certificates`, `report_runs`; migration 0007:
`weekly_reviews`, `monthly_reviews`). 31 tables total,
unchanged. No old migration was edited.

## Spec covered

- §26 Certificates: a monthly ITG Performance Certificate is
  issued only when every criterion is met, with a unique
  Certificate ID (`ITG-YYYYMM-XXXXXX`), trader name, month and
  the criteria evidence. If any criterion is missing, the page
  shows exactly which ones — never a certificate for unmet
  criteria, never a fabricated one.
- §27 Reports: daily/weekly/monthly reports from real trades —
  trades, P&L, win rate, risk, psychology, discipline, goals,
  lessons, and rule-based recommendations from the trader's own
  data (most frequent losing setup, low discipline, worst
  emotion, most repeated mistake). Viewable in-app, printable,
  downloadable as PDF.
- §21 Weekly review: the missing weekly-review flow from Phase
  7. Completing a review awards +30 XP via the existing
  `awardXp` path (idempotent per review id).

## Certificate eligibility thresholds (the product rule)

- Journaling: at least 5 closed trades in the month, at least
  80% journaled (psychology record or lesson).
- Risk discipline: at least 90% of closed trades disciplined
  (stop-loss set, leverage within the configured maximum when
  one exists) AND zero CRITICAL risk events in the month.
- Routine: active on at least 8 distinct days, spread over at
  least 2 distinct weeks.
- Review: at least one completed weekly review overlapping the
  month.
- A month with no closed trades meets no criterion — 0 trades
  is not 100% of anything.

## PDF

Library choice: **pdfkit 0.17.2** (added to `apps/web`).
A plain Node PDF writer with no browser/React dependency, it
works in a Next.js Route Handler and keeps each document in one
small function. @react-pdf/renderer would have added a React
render pipeline for static documents, so pdfkit is the smaller,
more maintainable choice.

Both PDFs are generated **on demand from the stored record** —
the certificate PDF from the certificate row's `criteria_met`
evidence, the report PDF from the computed summary. Neither is
stored in Supabase Storage in this phase; that is the Phase 13
step, and the pages/routes say so. `pdf_path` / `file_path`
stay null until then.

## Weekly review

- `/reviews/weekly`: the trader writes only the reflection
  (review text, main mistake, focus next week). The week's
  trades, P&L, win rate, journal completion and best/worst
  strategy are computed server-side from the real trades and
  stored on the `weekly_reviews` row (upsert per user+week).
- Completing a review awards +30 XP, idempotent per review id,
  plus a notification and a gamification refresh. A failed XP
  insert never loses the review.
- A completed weekly review counts toward the monthly
  certificate's review criterion.

## Routes

| Route | Purpose |
|---|---|
| `/certificates` | Current-month eligibility (each criterion met/missing), issue button when eligible, list of issued certificates with PDF download |
| `/certificates/[certificateId]/pdf` | Route Handler: PDF download, issued certificates only, owner only (404 otherwise) |
| `/reports` | Daily/weekly/monthly report (`?type=&date=`), stats, strategy + psychology breakdowns, recommendations, print + PDF download |
| `/reports/pdf` | Route Handler: PDF download for a valid type + period (400 otherwise) |
| `/reviews/weekly` | Weekly review form + past reviews with their computed aggregates |

Header navigation now includes Certificates, Reports, Weekly Review.

## Implementation

- `apps/web/lib/certificates/`: `types.ts`, `eligibility.ts`
  (pure: `evaluateMonthlyEligibility`, `generateCertificateId`,
  `monthStart`, `monthLabel`), `pdf.ts` (pdfkit),
  `queries.ts` (RLS-enforced reads, month aggregates),
  `actions.ts` (`issueCertificateAction`, service-role write —
  `certificates` has no client INSERT policy, migration 0009;
  idempotent per user+month, unique-ID retry on collision).
- `apps/web/lib/reports/`: `types.ts`, `reports.ts` (pure:
  `buildReportSummary`, `periodBounds`, rule-based
  recommendations), `queries.ts` (RLS-enforced reads),
  `pdf.ts` (pdfkit).
- `apps/web/lib/reviews/`: `types.ts`, `validation.ts`,
  `reviews.ts` (pure: `mondayOfWeek`, `weekBounds`,
  `computeWeeklyAggregates`, `WEEKLY_REVIEW_XP` = 30),
  `queries.ts`, `actions.ts` (`saveWeeklyReviewAction`).
- `apps/web/components/certificates/issue-certificate-form.tsx`,
  `apps/web/components/reports/print-button.tsx`,
  `apps/web/components/reviews/weekly-review-form.tsx`.

## Tests

- 238/238 Vitest tests pass (211 before + 27 new: 11
  certificate eligibility, 2 PDF smoke tests, 6 report
  aggregation, 8 weekly-review).
- `npm run typecheck` pass, `npm run lint` pass,
  `npm run build` pass — 22 routes now; `/certificates`,
  `/reports`, `/reviews/weekly` all build, both PDF routes are
  dynamic handlers.

## Errors fixed

- Three test expectations were wrong in my new tests (emotion
  breakdown needs ≥2 trades for a recommendation; the fixture
  change rippled into two breakdown assertions) — the
  implementation was correct in all three cases.
- Three type errors: `getReportSummary` took a needlessly
  complex Omit type (simplified to its real inputs);
  `saveWeeklyReviewAction` and the certificate action needed the
  `(prev, formData)` server-action shape for `useActionState`.

## Honesty notes / known limits

- Reports and certificate inputs run over the 500 most recent
  closed trades in the period (Phase 3 limit, carried forward).
- Goal counts in a report cover goals created in the period
  only; goals created earlier and completed in the period are
  not counted — Phase 12 can move this to a status-change
  timestamp if the schema grows one.
- Backtesting-session XP (+15) is still not wired: `daily_activity`
  is never written by any action yet (same note as Phase 7).
  That is a Phase 9/12 item, not a Phase 8 one.

## Phase 9 needs next

AI Coach (spec §28, §39): weekly analysis from real stored
data only — performance, mistakes, best/worst strategies,
psychology, risk, goals, discipline — stored in `ai_insights`
(migration 0009, already exists). It can reuse
`lib/reports/buildReportSummary` and the weekly-review
aggregates as its evidence base, and must never fabricate a
statistic: every insight cites its `metrics_snapshot`.
