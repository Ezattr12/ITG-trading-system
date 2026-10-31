# Master Web UI Redesign — Page 2: Add Trade

Mandate order: Dashboard (done) → **Add Trade** → Trades → … Visual redesign only, plus the one functional addition the mandate itself orders for this page: screenshot attach-at-create on the web form.

## What changed

- **Header band** → `.itg2-card` with `.itg2-eyebrow` ("Quick entry"), `.itg2-page-title`, updated subtitle (attach-at-create is now real), motto chip → `.itg2-chip-gold`. Back link → `.itg2-link`.
- **Form** (components/trades/quick-trade-form.tsx) restructured into glass sections with field/DOM order identical (tab order preserved): L2 "Execution — Market & prices" (Pair, Direction, Entry, Exit) → L1 "Risk — Targets & size" (TP, SL, Position size) → L1 "Context — Strategy" (only when strategies exist, as before) → L1 "Evidence — Screenshot" (attach mode only) → "More details" disclosure → explainer → submit.
- **New form system in itg2.css:** `.itg2-field` + icon tiles (TP profit-tinted, SL loss-tinted), `.itg2-label`, `.itg2-input/.itg2-select/.itg2-textarea` (48px, deep-blue glass, cyan focus glow), `.itg2-segmented` direction control (Long = profit-green→cyan glow, Short = loss-red→pink, unselected = neutral glass; same hidden `direction` input, role/aria preserved), `.itg2-btn-save` on `.itg2-btn-primary`, `.itg2-upload` dropzone + preview, `.itg2-card-flat` (form panels opt out of hover-lift). All field names, defaults, placeholders, `required` flags, helper texts and validation preserved verbatim — only screenshot copy changed.
- **Attach-at-create** (components/trades/attach-screenshot.ts, pure orchestration + 14 unit tests): the create action's existing `{ ok, redirectTo: "/trades/<id>?saved=1" }` result supplies the trade id — no contract change, no parallel endpoint. The `screenshot` entry is removed from the FormData before create (payload byte-identical; test-verified). After a successful create, the EXISTING `uploadScreenshotAction` runs with `{tradeId, screenshot}` — same private bucket, same server checks (image/*, ≤ 5 MB; client mirror uses the identical limits/messages), same audit row. Upload failure or transport throw → the trade still succeeds and the redirect gains `&shot=failed`. No file picked → the submit path is untouched. QuickTradeForm gained an optional `attachScreenshot` prop (default off) so the detail-page correction form never shows the block.
- **Minimal detail-page notice (Page-2-driven, flagged):** app/trades/[id]/page.tsx accepts `?shot=failed` and renders an amber banner in the page's existing notice style: the trade saved, the screenshot did not, add it in the Screenshots section. Page 4 will redesign that page wholesale.

## Cascade lessons applied (from Page 1)

- `.input-surface` (globals) is plum (`hsl(272 …)`) and is emitted unlayered after the @import point; the control selectors are therefore element+class (`input.itg2-input`, (0,1,1)) in itg2.css's unlayered tail.
- Tailwind preflight's `button { background: transparent }` is emitted unlayered and killed the layered `.itg2-btn-primary` gradient; all button paint declarations now live in the unlayered tail (level-scope precedent).

## Gate evidence

- Vitest 752/752 (75 files; +14 for the attach orchestration) · Playwright e2e 36/36 · typecheck clean · lint 0 errors · build OK (First Load JS unchanged) · security check passed.
- Visual verification (local production build, test account A): form at 390/1280, zero overflow; computed styles confirm the intent — input `linear-gradient(rgba(21,56,116,.42), rgba(8,20,44,.55))` with border `rgba(120,175,255,.28)`; Save button `linear-gradient(135deg, #0B3F91, #1268D8 55%, #2E7CF6)`; Short segment renders the red/pink selected state; the form's own validation error (exit price without closing time) renders correctly in the new design.
- **Functional end-to-end (real UI, production backend):** filled the redesigned form as A, attached a PNG, saved → landed on `/trades/<id>?saved=1`; SQL verified the trade (XAUUSD long, closed) + its `trade_screenshots` row + the object present in the private `trade-screenshots` bucket. Cleanup removed the object (Storage API 200), screenshot row, the +10 XP row, the level-up notification and the trade; A's baseline re-verified exact (10 trades, XP 390, 2 screenshots, 12 notifications, closed P&L 3702.500000). Audit rows from the test remain, as designed (append-only).
- Production: deployment `dpl_D1NtNQ8exY3DUPLVinrEj8n5g8xf` READY, alias-verified.

**Page 2 gate: PASSED. Next: Page 3 — Trades.**
