# Phase 3 — Core Trading Journal

Status: implemented locally, tested. **Supabase is not connected yet** —
trade code is real and complete, but no trade can be saved until a
Supabase project exists and its URL/keys are set. The UI says so
clearly (submit is disabled until then, via the shared `ActionForm`).
No demo trades, no fake P&L, no mock dashboard data.

## Spec covered
- §9 Journal: minimal Quick Entry (pair, long/short, entry, exit, TP,
  SL, position size, leverage, fees, date/time). P&L, ROI, R multiple,
  risk/reward, win/loss and duration are computed server-side
  (`lib/trades/calculations.ts` → `packages/calc`) — the trader never
  enters them. Open trades have no P&L: every calculated field is
  null until the trade closes.
- §10 Screenshots: upload 1+ per trade to Supabase Storage bucket
  `trade-screenshots` (images only, 5 MB max, per-user path, signed
  URLs for preview). Disabled with a clear error until Supabase is
  connected / the bucket exists. OCR: architecture only —
  `lib/trades/ocr.ts` validates the shape an OCR result must have,
  but no OCR service is connected and no extraction is faked.
  `ocr_status` stays `not_applicable` until a service exists.
- §11 Strategy: system strategies (FVG, Order Block, Breaker,
  Liquidity Sweep, MSS, BOS, OTE, SMT, Other) from the Phase 1 seed;
  a typed setup name creates the trader's own setup row.
- §12 Market condition, §13 trade reason (including FOMO / Revenge /
  Random for honest journaling, never encouraged), §14 psychology
  (confidence 1–5, emotion, discipline), §15 lesson ("What did I
  learn?") with repeated-lesson detection (`lib/trades/lessons.ts`:
  normalised grouping, count ≥ 2, trader's own wording kept).
- §16 Quick Entry vs Advanced Review: quick entry alone is a valid
  trade; the review (strategy, setup, market, reason, session,
  psychology, lesson, notes) is optional and can be added later
  from the trade page.
- §32 Search & filters: pair, date, long/short, strategy, setup,
  session, win/loss, psychology, confidence, discipline, market
  condition, plus free-text search. Filters live in the URL.
- §33 Trade review: detail page with screenshot(s), trade data,
  performance, strategy, risk, psychology, notes, lesson, AI
  insight, related trades (same pair).

## Routes
| Route | Purpose |
|---|---|
| `/trades` | List + filters, pagination (20/page) |
| `/trades/new` | Quick Entry form |
| `/trades/[id]` | Detail, advanced review, screenshots, correction, cancel, related trades |

## Financial facts — corrections, not edits
Trades are immutable (migration 0004, no DELETE policy):
- **Correction:** `correctTradeAction` inserts a new trade with the
  corrected values and marks the original `status='reversed'` with
  `reversal_trade_id` pointing at the correcting trade. The
  original values stay in the audit trail.
- **Cancel:** only an *open* trade can be cancelled
  (`status='cancelled'`, two-step confirm). A closed trade cannot
  be deleted — it is corrected by reversal instead.
- **Screenshots** may be deleted (their RLS allows it; the Storage
  object is removed too), two-step confirm.

## XP
Saving a trade awards +10 XP (`xp_transactions`, reason
`trade_journal`, spec §24). The insert is best-effort: a failed XP
write never loses a trade. Levels/achievements themselves are
Phase 7.

## AI insight
The detail page states honestly that AI insight is not available
until Phase 9. Nothing is fabricated or shown as an insight.

## Known limits (to fix in later phases)
- List filtering: DB filters run in the Supabase query; psychology /
  outcome / search filters run in memory over at most the 500 most
  recent trades (see `lib/trades/queries.ts`). Phase 12 pushes
  these into the query if a journal grows past that.
- No live Supabase project, no Vercel deployment (Phase 13).
- No OCR service, no AI Coach (Phase 9).

## Tests
Vitest, 37 new tests (83 total, was 46):
`lib/trades/validation.test.ts` (14), `calculations.test.ts` (8),
`filters.test.ts` (7), `lessons.test.ts` (4), `ocr.test.ts` (4).
Mocks are used only inside tests, at the client boundary; production
code never mocks Supabase.

## Verification
- `npm run typecheck` — pass (web + calc)
- `npm test` — 83/83 pass
- `npm run lint` — pass
- `npm run build` (apps/web) — pass, 14 routes; `/trades` 106 kB,
  `/trades/new` 117 kB, `/trades/[id]` 133 kB first load

## Phase 4 needs next
- Dashboard analytics from real trades (equity curve, win rate,
  profit factor, expectancy, drawdown, strategy/session/direction/
  psychology breakdowns), trading calendar, progress page.
- The dashboard already lists the 5 most recent real trades;
  Phase 4 replaces the placeholder copy with computed stats.
