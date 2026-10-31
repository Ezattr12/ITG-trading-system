# Master Web UI Redesign — Page 3: Trades

Mandate order: Dashboard → Add Trade → **Trades** → Trade Detail → … Visual redesign only.

## What changed

- **Header** → `.itg2-card` band (eyebrow "Journal", `.itg2-page-title`, the exact count lede verbatim, "+ Add trade" as `.itg2-btn-primary`).
- **Filters** → L1 glass panel; all 12 fields (q, pair, direction, strategyId, session, outcome, marketCondition, emotion, discipline, confidence, from, to) keep exact names/defaults/options on the Page-2 `.itg2-input`/`.itg2-select` system; Filter → `.itg2-btn-primary`, Clear → `.itg2-btn-ghost` (same GET-form behavior; the old UI had no active-filter indicator, none invented).
- **Desktop table** → `.itg2-table` in an L2 panel (the panel remains the horizontal scroll region): sticky deep-navy small-caps header, glass separators, blue-tint hover, tabular figures, same 9 columns (Pair, Direction, Strategy, Opened, Entry, Exit, P&L, R, Status). Rows carry a direction accent (`.itg2-row-long` profit→cyan / `.itg2-row-short` loss→pink) that brightens on hover.
- **Mobile cards** → `.itg2-card` with a gradient direction accent on the left edge; same breakpoint mechanism (`md:hidden` cards / `hidden md:block` table, same row data). Pair link, direction chip (Page-1 chip pattern), muted status/strategy chips (new `.itg2-chip-muted`), large semantic P&L, meta line date · session · R · entry→exit. (Session was already on the row data; the old card didn't show it — now rendered from the real `SESSION_LABELS` per the mandate's card spec.)
- **Pagination** → ghost buttons with the same hrefs/conditions; the current page is now a clear indicator chip (`aria-current="page"`, "Page X of Y"); the "showing the N most recent trades for filtering" note preserved.
- **Empty states** (no trades / no filter results) → L2 glass panels, both copy variants and CTAs verbatim.

## Systemic fix made during this page's verification (benefits all pages)

The bare Filter `<button class="itg2-btn-primary">` computed to 40px wide / padding 0: the unlayered Tailwind preflight reset (`padding: 0`, font-size/weight/color: inherit) also beats the layered base rule's box/typography — Page 2's unlayered move carried paint only, and the Save button had masked the gap via `.itg2-btn-save`'s width. The unlayered tail now mirrors the FULL box + typography declarations for `.itg2-btn-primary` / `.itg2-btn-ai` / `.itg2-btn-ghost` (values identical to the layered base). Verified computed: Filter button 78×45px, padding 10px 18px. **Rule for later pages: any `.itg2-btn-*` used on a bare `<button>` is safe now; any new button class must put box + type + paint in the unlayered tail.**

## Gate evidence

- Vitest 752/752 · Playwright e2e 36/36 · typecheck clean · lint 0 errors · build OK · security check passed.
- Visual verification (local production build, test account A, real 10-trade journal): desktop table judged in a viewport screenshot (crisp white pair names, muted meta, semantic P&L, direction accents — an earlier full-page capture looked washed out purely from stitch/reveal timing; computed colors confirmed full-strength: cell color rgb(244,248,255), opacity 1); mobile cards at 390 (accent bars, chips, big P&L, session/R meta); zero horizontal overflow at 390 and 1280; table probe confirmed all 10 rows with the known values (1,500.00 / −0.20 / XAUUSD present).
- Production: deployment `dpl_3vq66fNni6LeY6yvEssxffqXrza6` READY, alias-verified.
- Ops note: a service restart mid-gate wiped /tmp (env/QA/session/upload state); all helpers were recreated from their documented recipes and the gate re-run cleanly — no work lost (the tree lives under ~/workspace).

**Page 3 gate: PASSED. Next: Page 4 — Trade Detail.**
