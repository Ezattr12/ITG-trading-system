# Delete Trade — production feature (2026-11-01)

Ezat's mandate: a first-class Delete Trade whose backend is a SAFE
FINANCIAL RECORD REMOVAL — no hard delete, no new status, built on
the existing lifecycle.

## Lifecycle used (audit outcome)

- **Open trade** → the existing `cancelTradeCore` path:
  status `cancelled`, existing `trade.cancelled` audit.
- **Closed trade** → voided by reversal: status `reversed` with
  `reversal_trade_id` NULL (annulment — no correcting trade). This
  follows the founding rule (migration 0004): a closed trade is a
  financial fact, never cancelled, only reversed. Analytics,
  reports and Coach all read only `status='closed'`, so the
  removal propagates to every statistic by the status change
  alone — nothing is merely hidden in the UI.
- **Already cancelled/reversed** → idempotent no-op
  (`already_removed`), zero writes, zero new audit rows.
- **Not owned / nonexistent** → the pipeline's indistinguishable
  `not_found` (404), identical to Edit/Correction.

One composing core, `deleteTradeCore` (`lib/trades/service.ts`),
mirroring `editTradeCore`. On an actual removal it writes exactly
one **`trade.deleted`** audit row: `{ previousStatus, pair,
direction, pnl, openedAt, reason }` — who (audit userId) and when
(row timestamp) included. An optional reason
(mistake/duplicate/test/incorrect_entry/other) is validated at
the core; an invalid value is refused (`invalid_input`). Closed-
trade removal fires the existing Coach insight refresh, exactly
like a correction.

## Visibility

`getTradeListItems` now excludes removed trades from the active
journal (post-fetch filter `isActiveJournalTrade`, commented in
code): cancelled trades and voided trades (reversed, no
correcting trade) are excluded; corrected originals (reversed
WITH a correcting trade) remain, preserving the visible
correction chain. The filter sits in the shared query, so the
detail page's Related trades behave identically. A removed
trade's detail page stays reachable by direct link (owner only)
and shows "This trade was removed from the active journal. Its
record is preserved for audit history."

## Surfaces

- **Web**: Trades list — View | Edit | Delete (desktop) and
  View/Edit/Delete on mobile cards (open/closed only); Trade
  Detail — a "Danger zone / Delete this trade" section after the
  untouched Cancel section. Confirmation is a dedicated glass
  dialog (`components/trades/delete-trade-dialog.tsx`):
  consequence copy, trade identity (pair, direction, status,
  opened date, P&L), optional reason select, Cancel + red
  Delete. Success lands on `/trades?deleted=1` with
  "Trade removed successfully."
- **Web action** `deleteTradeAction` (session identity only;
  revalidates /trades, the trade page, /dashboard, /analytics,
  /reports).
- **Mobile API**: `POST /api/mobile/trades/[id]/delete`
  (`handleDeleteTrade`; body `{}` or `{ reason }`; identity /
  unknown keys → 400 naming the field; invalid reason → 400;
  one `api.mobile.trade_deleted` audit row per call). 200
  `{ trade_id, previous_status, already_removed }`.
- **Mobile app**: trade detail Delete action (open/closed) with
  an in-card confirmation panel (identity, consequence copy,
  reason chips, red confirm); success returns to the trades
  list.

## Invariants

- **Hard delete: impossible** — no code path issues DELETE on
  trades; the row, its stored metrics and its history persist.
- **XP/achievements: untouched** — append-only ledger; the
  cancel/correction precedent (delete never awards or revokes).
- **Screenshots: preserved** on the removed trade's record,
  private bucket, owner-only signed access (verified in
  production: the record survives deletion; cross-user detail
  serves no trade data).
- **Atomicity note**: as with Edit, the cores are sequential,
  not one DB transaction (pre-existing architecture); each step
  is a single-row update or an append-only audit insert, and
  failures surface as errors — never silent partial success.

## Verification

- Tests: 781 → **803** (+22: core lifecycle matrix, handler
  matrix incl. byte-identical 404s, action results, list
  exclusion). Vitest 803/803, Playwright 36/36, typecheck/lint/
  build clean, security check 391 files, mobile tsc + export OK.
- Visual QA (local, account A, no mutation): list Delete
  actions + dialog at 1280, detail danger zone + dialog at 390,
  zero horizontal overflow; dialog identity/consequence verified.
- **Production test** (throwaway accounts only, deployment
  `dpl_35NBxHpnyd1mkz3UUCFzjkR41HVM`): closed trade + screenshot
  created (baseline summary 1 trade / P&L 10) → cross-user delete
  → 404, trade untouched → owner delete (reason "test") → status
  reversed with NULL reversal link, exactly one `trade.deleted`
  audit (previousStatus closed, P&L 10, reason test), XP
  unchanged, screenshot record preserved, summary → 0 trades /
  P&L 0 → web list excludes it, owner detail shows the removed
  notice, another user's detail serves no trade data → repeat
  delete → already_removed, audit count still 1 → open trade
  deleted → status cancelled with both audit rows → throwaway
  cascade-deleted; verification account A untouched
  (10 trades / XP 390). **All checks passed.**
