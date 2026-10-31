# Master Web UI Redesign — Page 4: Trade Detail

Mandate order: Dashboard → Add Trade → Trades → **Trade Detail** → Analytics → … Visual redesign only.

## Honest scope note

The mandate's page brief lists an "audit history" section. This page has never had one: `getTradeDetail` returns no audit rows, and inventing one would require a data change plus fake surface area. What the page does show — the reversal / correcting-trade banners ("the original values are kept for the audit trail") — was restyled as `.itg2-notice` bars. A real audit-history timeline remains possible future work under separate authorization (a read query + this presentation), not part of a visual pass.

## What changed

- **Hero (L3 `.itg2-hero`):** pair as page title, direction chip (Long profit / Short loss), status chip (blue open / muted settled), Win/Loss chips, opened/closed lede verbatim, P&L as the hero figure (semantic; open trades read "Open"), R multiple + ROI in the hero band, CSS rings accent.
- **Metrics:** 9 glass tiles (Entry, Exit, TP, SL, Position size, Fees, Risk/reward, Duration, Leverage) — every value expression and `—` placeholder verbatim.
- **Panels (`.itg2-card` + eyebrow titles):** "Strategy & session" (Strategy, Setup, Session, Market condition, Trade reason as `.itg2-row` definition rows); "Psychology & lesson" (confidence/emotion/discipline rows, lessons, the repeated-lesson banner → `.itg2-notice-warning`, notes); "Related trades" (glass rows, semantic P&L).
- **Screenshots:** each in an `.itg2-shot` glass frame over the existing signed URLs (no lightbox invented — images were plain imgs and stay that way), long names `break-all`-safe at 320px, delete keeps its two-step confirm (ConfirmButton restyled: ghost / new `.itg2-btn-danger` in the unlayered tail, arm logic byte-identical). The uploader is now the Page-2 `.itg2-upload` dropzone with the real input overlaid (native `required` validation intact), same action/limits/copy.
- **AI insight** → `.itg2-card-ai` + orb, the page's only violet surface; honest unavailable copy verbatim.
- **Advanced review:** flat L1 panel on the Page-2 form system. Field set provably identical post-edit (all 11 `name=` attributes + every `defaultValue` checked — strategy `trade.strategy_id` and setup `detail.setupName` round-trip untouched, per the standing full-form rule); submit via ActionForm's existing `submitClassName`.
- **Corrections:** container only — the shared QuickTradeForm is untouched and correctly shows no screenshot block here. **Cancel** panel with "Danger zone" eyebrow and the new danger button.
- **Banners:** saved → `.itg2-notice-success` (component restyled, dismiss identical); `?shot=failed` (Page 2) + reversed → `.itg2-notice-warning`; corrects → `.itg2-notice-neutral`. Texts verbatim.
- New CSS: `.itg2-notice` (+variants), `.itg2-stat-value`, `.itg2-row`, `.itg2-inset`, `.itg2-shot` (layered, no legacy competition), `.itg2-btn-danger` (unlayered tail, full box+type+paint per the Page-3 rule).

## Gate evidence

- Vitest 752/752 · Playwright e2e 36/36 · typecheck clean · lint 0 errors · build OK (First Load JS unchanged) · security check passed.
- Visual verification (local production build, test account A, the XAUUSD +1.20 trade with 2 screenshots): hero, 9 tiles, context/psychology panels, screenshot frames, review form pre-filled with BOS + "London open breakout" (round-trip visible in the rendered select value `4e140f17…`), corrections form without the screenshot block — at 390 and 1280, zero overflow. (Screenshot image bytes themselves load from signed URLs on production; locally the sandbox browser tunnel can't fetch them — frames/alt/Delete controls verified.)
- Production: deployment `dpl_D8otSjcoFS3nDppVWkPahRfegguB` READY, alias-verified.

**Page 4 gate: PASSED. Next: Page 5 — Analytics.**
