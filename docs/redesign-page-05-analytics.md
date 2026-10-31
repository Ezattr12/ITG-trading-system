# Master Web UI Redesign — Page 5: Analytics

Mandate order: … → Trades → Trade Detail → **Analytics** → Goals → … Visual redesign only.

## What changed

- **Header band** (`.itg2-card-flat`): eyebrow "Performance", page title, the dynamic lede verbatim ("8 closed trades. All figures are calculated from your real trades." / no-trades variant).
- **KPI row:** the 8 StatCards rebuilt on the Dashboard's `.itg2-kpi` pattern (icon tile, label, big value) with every value expression byte-identical; legacy glow conditions mapped 1:1 to icon tones (P&L by sign, profit factor vs break-even incl. the Dashboard's verbatim "Above/Below break-even" chip and definition hint, drawdown in the loss tone). One flagged copy reuse: the PF card carries the Dashboard PF card's own definition hint "Gross profit ÷ gross loss." — existing product copy, not new text.
- **Performance hero:** L2 elevated panel — equity headline in `.itg2-hero-value` with the existing semantic classes, the shared `EquityChart` wrapped in the SAME `.itg2-chart-scope` the Dashboard uses (cyan curve natively, component internals untouched), the equity table (Date closed / Cumulative P&L / Drawdown) as `.itg2-table-fit`.
- **New `.itg2-chart-pool`**: chart-scope's panel/grid/tick treatment WITHOUT the area-curve stroke override — built precisely so the Drawdown chart keeps its honest red series while gaining the glass panel. Drawdown and Period-P&L and R-distribution charts render inside it; every chart component's internals are untouched (period bars keep per-bar green/red; R bars were already blue).
- **Win/loss** ring (`--win-rate` conic, green) and best/worst rows unchanged in data and semantics; container glassed.
- **Period pills:** legacy `.itg-range` violet pill → `.itg2-range` blue-gradient active pill; same links/hrefs/`aria-current`; targets now 44px (legacy ~33px).
- **Breakdowns** (strategy / session / direction, psychology vs performance): glass panels with `.itg2-table-fit`, "Best P&L" as `.itg2-chip-profit` under the same `best.key` condition; empty-state copy verbatim.
- **Intelligence** (7 panels + week/month digests): all glassed with eyebrows (Risk / Psychology / Discipline / Strategy / Intelligence / Performance), tables fitted, Best/Worst pills semantic; **all gating copy verbatim**; no section invented or dropped.
- CSS additions are three new class names only (`.itg2-chart-pool`, `.itg2-table-fit`, `.itg2-range`); no existing rule modified.
- **Dashboard insulation:** `charts.tsx`, `stat-card.tsx`, `globals.css` untouched; grep proves the Dashboard references none of the three new classes — its rendering is byte-identical by construction. `DrawdownChart` is shared with Reports' catalog sections; its internals were not changed (pool is applied at this page's wrappers only), so Reports is unaffected until its own page (Page 9).

## Gate evidence

- Vitest 752/752 · Playwright e2e 36/36 · typecheck clean · lint 0 errors · build OK (First Load JS unchanged) · security check passed.
- Visual verification (local production build, test account A): all 8 KPIs with real figures (3,702.50 / 87.5% / 18513.50 PF / 0.20 drawdown / 1.12R), equity curve + cumulative table matching the journal exactly, win ring 88%, drawdown chart still red, period bars green, breakdowns with BOS 2.20 / No-strategy 3,700.30 / London 1,201.20, intelligence panels with the real improvement plan and digests — at 390 and 1280, zero page overflow; multi-column tables scroll inside their panels by design (same mechanism as Page 3's table panel).
- Production: deployment `dpl_CnzHc8GA8USRquZpS55QymZgJP5o` READY, alias-verified.

**Page 5 gate: PASSED. Next: Page 6 — Goals.**
