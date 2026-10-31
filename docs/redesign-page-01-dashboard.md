# Master Web UI Redesign — Page 1: Dashboard (+ v2 foundation)

Mandate: Ezat, 2026-10-31 — page-by-page transformation, strict order, each page fully gated before the next. This page also establishes the centralized v2 design foundation every later page reuses.

## The v2 foundation (apps/web/app/globals.css + app/itg2.css)

- **Palette rebalance to the mandated composition:** deep black base (`--itg-bg #04060C`, `--itg-bg-deep #03050A`), deep-blue family (`--itg-blue-950 #030714` → `-900 #06152F` → `-850 #08245A` → `-800 #0A2F70` → `-700 #0B3F91` → `-600 #1268D8` → `-500 #2E7CF6`, cyan `--itg-cyan-400 #00CFFF`), white foreground family (`#F4F8FF / #C9D6F2 / #7E8DB0`). Existing token NAMES kept — untouched pages inherit the new palette through the tokens they already consume. Profit `#21f3a5`, loss `#ff4d72`, warning, gold `#bd935f` unchanged; violet tokens retained for AI surfaces only.
- **Glass system (`.itg2-*` in itg2.css):** L1 `.itg2-card`, L2 `.itg2-card-elevated`, L3 `.itg2-hero` (layered navy→black gradients, animated light sweep, CSS glass rings — decorative light only, no data shapes). Physical-glass recipe: `::before` top-edge light, inset highlight, deep drop shadow, blue-tinted border brightening on hover with a small lift. Plus `.itg2-kpi` (icon tile + label + numeral + hint + value-driven status chip), `.itg2-chip`, `.itg2-progress`, `.itg2-btn-primary` / `.itg2-btn-ai`, `.itg2-eyebrow` / `.itg2-section-title`, `.itg2-card-ai` + `.itg2-ai-orb`. Reduced-motion disables sweep/progress animation; no-backdrop-filter fallbacks in navy.
- **Atmosphere:** body radials + ambient orbs restyled from globals.css (deep navy/royal/blue, ONE faint violet remnant ~5–7%) — `components/ambient-background.tsx` untouched (class contract restyled).

## Dashboard rebuild (app/dashboard/page.tsx — markup/classes only)

Zero data-logic changes: same server component, same calls in the same order, every href/aria-label/empty-state string preserved.

- Welcome + P&L blocks merged into ONE L3 hero: avatar, greeting/lede verbatim, P&L eyebrow + hero numeral (semantic positive/negative classes preserved), Closed/Wins/Drawdown stats, sparkline, and an identity band (Level in gold + score, XP total with real band-progress bar, profile completion % + real next-step text).
- KPI row (was shared StatCard) → `.itg2-kpi` cards; CountUp values and hints verbatim; chips value-driven (PF "Above/Below break-even", Avg R expectancy, streak state).
- Performance → L2 panel; EquityChart restyled ONLY inside `.itg2-chart-scope` (deep-blue pool, cyan line, blue→cyan fill, glow). The shared component and Analytics are untouched.
- Risk & discipline, Psychology, Recent activity → `.itg2-card` with eyebrow headers; links → `.itg2-link` (bright blue; violet links survive only on AI surfaces).
- Level & XP → `.itg2-card` + `.itg2-level-scope` (ring/track/completion fills blue→cyan; component markup/vars byte-identical; Profile keeps legacy violet until Page 7). Goals' ProgressBar replaced by `.itg2-progress` replicating its exact aria contract.
- Recent trades → premium glass rows (pair, direction chip from the real direction string, date, semantic P&L, same hrefs).
- AI Coach → `.itg2-card-ai`: the page's only violet surface, CSS orb, same stored insights + honest empty state.

## Engineering notes (hard-won, apply to every later page)

- **Stylesheet split:** the redesign pushed globals.css to 98.5 KB, whose base64 exceeds the deploy uploader's single-argv limit (131,072 B). The `.itg2-*` system now lives in `app/itg2.css`, `@import`ed at the top of globals.css. Keep individual stylesheets ≲ 90 KB.
- **Cascade layers:** layer order is declared explicitly (`@layer base, components, itg2, utilities;`) at the top of BOTH stylesheets, because the first chunk to name the layers fixes their order. The legacy `.itg-level-ring` / `.itg-xp-*` / `.itg-completion-ring` rules are emitted UNLAYERED by the Tailwind pipeline, and unlayered styles beat all layered styles — so the `.itg2-level-scope` overrides are deliberately UNLAYERED at the end of itg2.css (their two-class selectors win on specificity). Verified by computed style: ring = `conic-gradient(rgb(0,207,255) …)`.

## Gate evidence

- Vitest 738/738 · Playwright e2e 36/36 · typecheck clean · lint 0 errors · build OK (First Load JS unchanged, 103 kB; no new dependencies) · security check passed.
- Visual verification (local production build, signed in as verification test account A, real data): full-page screenshots at 320/390/768/1280 — no horizontal overflow anywhere; mobile bottom-viewport check confirms the fixed nav never covers content; computed-style check confirms the cyan level ring.
- Production: deployment `dpl_HB7ZgT6yEAhUuCotZdMLJJbXFSeJ` READY; alias `itg-traderos.vercel.app` resolves to it; the live login page links CSS chunk `84c5060c20bda11c.css`, content-hash-identical to the locally verified build, containing the `.itg2-hero` system.

**Page 1 gate: PASSED. Next: Page 2 — Add Trade.**
