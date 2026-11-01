# Edit Trade — production feature (2026-11-01)

Ezat's mandate: a first-class, end-to-end Edit Trade feature —
Trades → Open Trade → Edit → Save → Recalculate → Persist → Audit →
Reflect everywhere — built on the existing correction architecture,
not a second update system.

## Architecture decision (audit outcome)

Trades are financial facts (migration 0004): no delete policy, no
in-place edit of a closed trade; corrections are reversing trades.
The audit found the existing cores sufficient:

- `correctTradeCore` — reversal correction over the quick-trade
  fields, metrics recomputed by `computeTradeMetrics` (@itg/calc),
  audit `trade.corrected`, no XP.
- `saveAdvancedReviewCore` — in-place journal update (strategy,
  setup, session, market condition, trade reason, notes) +
  psychology upsert + lesson insert/dedupe, audit
  `trade.review_saved`.

**One new composing core** — `editTradeCore`
(`apps/web/lib/trades/service.ts`) — diffs the full-form submission
against the stored trade (Decimal equality for numerics, instant
comparison for timestamps, blank ≡ null for journal text, setup
compared by resolved name, lesson changed only when its normalized
text is new to the trade) and routes by what changed:

- **Financial change** (pair, direction, entry, exit, TP, SL,
  position size, leverage, fees, opened/closed times) →
  `correctTradeCore`, then the journal state is always re-applied
  to the corrected trade via `saveAdvancedReviewCore`, so
  psychology and lessons carry over losslessly (a correction
  insert never carried them). If the carry-over fails, the core
  returns an honest `save_failed` naming the corrected trade and
  asking the trader to re-save its review — never a silent
  partial state.
- **Journal-only change** → `saveAdvancedReviewCore` in place on
  the same trade. No reversal, no new trade.
- **No change** → zero writes, zero audit rows, "No changes to
  save."
- Reversed original → business error pointing at the correcting
  trade; cancelled → terminal error; not-owned → `not_found`.

Exactly one **`trade.edited`** audit row per effective edit
(entity = the original trade) with `{ changedFields,
financialChanged, journalChanged, previousPnl, newPnl,
resultingTradeId }`, on top of the cores' own rows. The edit path
never inserts XP (asserted by test).

## Surfaces

- **Web action** `editTradeAction` (session identity only;
  revalidates /trades, both trade pages, /dashboard, /analytics;
  redirects to the resulting trade `?saved=1`).
- **Web page** `/trades/[id]/edit`: v2 glass form — "Trade
  details" (quick fields) + "Journal & review" (review fields),
  exact existing FormData names; screenshots section reusing the
  detail page's components (evidence stays attached to the
  trade's record). Reversed/cancelled trades render an
  explanatory notice instead of a form (reversed links to the
  correcting trade's edit page).
- **Confirmation**: a financial change intercepts submit with a
  before/after panel — each changed financial field old → new,
  plus P&L / R / ROI / risk-reward before → after from
  `computeTradeMetrics` (the same function the server runs).
  Journal-only saves submit directly. Derived values are never
  inputs anywhere.
- **Entry points**: Trades list — View | Edit actions column
  (desktop) and View/Edit on mobile cards; Trade Detail hero —
  "Edit Trade" button. Open/closed trades only.
- **Mobile API**: `POST /api/mobile/trades/[id]/edit`
  (`handleEditTrade`, same pipeline: identity/unknown keys → 400
  naming the field at envelope and nested level; one
  `api.mobile.trade_edited` audit row per call). Status codes:
  financial edit → 201 (a correcting trade was created),
  journal-only / no-change → 200.
- **Mobile app**: Edit screen (`trade/[id]/edit`) — one form,
  financial + journal sections, client-side diff, confirmation
  step with new P&L/R/ROI from the vendored @itg/calc
  primitives (`decimal.js` added to the app's dependencies for
  the vendored package), success navigates to the resulting
  trade. "Edit trade" button on the trade detail (open/closed
  only). Existing Correct/Close/Review screens untouched.

## Protected fields

Never editable, never accepted from payloads: user/owner id
(identity comes from the session/token; the schemas strip forged
identity keys — tested), created/updated timestamps, status
(lifecycle moves only through the existing cores), all calculated
fields (pnl, roi_pct, r_multiple, risk_reward, is_win,
duration_seconds — computed server-side only), reversal links,
XP/achievement records. "Motivation" is not a trade field in the
schema (separate content table) and is not part of the form.

## Verification

- Unit/integration: 759 → **781 tests** (+22: editTradeCore
  matrix incl. direction-flip P&L sign vs @itg/calc, fees-only =
  financial, lesson dedupe, forged user_id stripped, cross-user
  not_found with zero writes, no-change zero writes; handler
  matrix incl. nested identity 400s and byte-identical 404s;
  action redirects). All existing tests unmodified.
- Gate: Vitest 781/781, Playwright 36/36, typecheck + lint
  clean, production build clean, security check 387 files,
  mobile tsc + expo export clean. Edit page overflow-free at
  320/390/1280 in local QA; the confirmation panel exercised
  locally without submitting.
- **Production test** (throwaway account, deployment
  `dpl_HeuCxNT8A6BPSEVziSvd5hUypqPm`): created XAUUSD long
  2000→2010, size 1, SL 1990 (baseline P&L 10, R 1, ROI 0.5,
  XP 10) → edited exit to 2005 → original reversed and linked,
  corrected trade P&L 5 / R 0.5 / ROI 0.25, XP unchanged,
  `trade.edited` audit with changedFields [exitPrice] and
  P&L 10 → 5, summary endpoint total 5 (analytics consistent,
  reversed original excluded) → journal-only edit (emotion,
  notes) applied in place with no new trade → no-change edit
  wrote no audit → cross-user edit attempt returned 404 and
  changed nothing → web /trades shows Edit links, corrected
  detail shows the corrected P&L, edit page renders → throwaway
  deleted with cascade; verification account A untouched
  (10 trades / XP 390). **All checks passed.**
