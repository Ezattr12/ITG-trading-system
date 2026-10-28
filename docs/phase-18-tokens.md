# Phase 18 — Design System Foundation (Tokens, Typography, Primitives)

Status: **implemented and verified locally. Not deployed, not committed** —
deploy + GitHub commit + the production build are the coordinator's steps,
as briefed. Worker 1 owned only the files listed at the end; no other
file was touched.

## What this phase (Worker 1) is

The foundation layer of the Phase 18 major visual redesign: the colour +
depth token system, the single font family, the ambient background
contract, and the restyled shadcn primitives. Other workers build
screens on top of these tokens and classes. Nothing functional changed:
no business logic, auth, calculation, routing, security, migrations,
or new dependencies. No fake data.

## References — what was taken, and what was not

Five images were read first (all distinct MD5s in this batch — no
duplicates, unlike Phase 17):

- SHRUHH glass login: **taken** — glass card depth from a bright top
  edge, translucent layered surface, soft shadow over a flowing
  backdrop. **Not taken** — the name, logo, purple palette, gradient
  button, wording.
- Delivery app: **taken** — one strong blue hero card, dark secondary
  cards, status chips, separated list rows, raised centre `+` bottom
  action. **Not taken** — the delivery domain, wording, figures.
- Beyond finance: **taken** — the 3D ribbon idea (depth from a flowing
  form, not from a flat panel), cards screen, transaction detail
  hierarchy. **Not taken** — branding, layout, numbers.
- Aura AI: **taken** — activity cards with a small readable chart
  inside, generous card padding, history list with separated rows.
  **Not taken** — the purple-gradient app, the fitness content, the
  voice.
- Fintech mobile: **taken** — the balance hero card with a sparkline,
  overview icon row, recent activity list, floating bottom nav.
  **Not taken** — branding, name, balance figure, layout.

Deliberately **not** taken from any reference: no purple rebrand (navy
stays the base; violet/cyan are accents), no copied branding, logo,
text, numbers or exact layouts, no neon or glow-heavy surfaces, no
casino/crypto styling, no fake badges or fake data.

## Colours and roles

All tokens live in `apps/web/app/globals.css` (`:root`) as HSL triples
and are consumed through Tailwind — no page hard-codes a colour.
Everything Phase 15/17 defined is untouched; Phase 18 only adds.

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `222 33% 9%` | Deep navy page base (unchanged) |
| `--background-2` | `228 40% 12%` | Midnight blue — deeper panels, hero bases |
| `--background-3` | `220 20% 15%` | Charcoal — tertiary surfaces |
| `--card` | `222 28% 13%` | Card surface (unchanged) |
| `--primary` | `217 91% 60%` | Blue/indigo brand and action accent (unchanged) |
| `--cyan` | `187 92% 48%` | Cool data accent — charts, secondary highlights |
| `--violet` | `262 83% 68%` | AI accent (same value as `--ai`, named so non-AI uses don't imply intelligence) |
| `--indigo` | `232 80% 64%` | Blue-to-violet bridge in gradients |
| `--gold` | `43 96% 56%` | Achievements, certificates, premium marks only |
| `--success` / `--destructive` / `--warning` / `--info` / `--ai` | unchanged | Profit, loss/risk, warning, info, AI |

Tailwind maps `cyan`, `violet`, `indigo`, `gold` to these vars
(`bg-cyan`, `text-violet`, `border-gold`, …). No existing code used
the numbered Tailwind cyan/violet/indigo/gold scales, so replacing
those palettes with single-value colours is safe (verified by grep
before the change; the numbered scales still in use — emerald, amber,
red — were not touched).

## Gradients

| Token | Value | Use |
| --- | --- | --- |
| `--gradient-primary` | `135deg, hsl(217 91% 60%), hsl(232 80% 60%)` | Primary buttons, primary accents |
| `--gradient-cyan` | `135deg, hsl(199 89% 48%), hsl(187 92% 48%)` | Cyan accents, data highlights |
| `--gradient-ai` | `135deg, hsl(262 83% 68%), hsl(232 80% 64%)` | AI buttons and marks |
| `--gradient-gold` | `135deg, hsl(43 96% 56%), hsl(32 95% 50%)` | Gold buttons and premium marks |
| `--gradient-hero` | `160deg, hsl(228 45% 18%), hsl(222 33% 11%) 55%, hsl(232 50% 16%)` | Hero card surface — a navy sweep, not a colour statement |

Tailwind: `bg-gradient-primary`, `bg-gradient-cyan`, `bg-gradient-ai`,
`bg-gradient-gold`, `bg-gradient-hero`.

## Glows

Two-layer, soft, low-opacity shadows — a tighter core glow plus a
wide faint halo. A glow marks **one** focal surface per view; a glow
on every surface would read as neon, not institutional.

| Token | Core | Halo | Use |
| --- | --- | --- | --- |
| `--glow-primary` | `0 0 24px rgb(59 130 246 / 0.30)` | `0 0 64px rgb(59 130 246 / 0.10)` | Primary buttons, focus, hero |
| `--glow-cyan` | `rgb(34 211 238 / 0.28)` | `rgb(34 211 238 / 0.10)` | Cyan accents |
| `--glow-violet` | `rgb(167 139 250 / 0.30)` | `rgb(167 139 250 / 0.10)` | AI surfaces |
| `--glow-success` | `rgb(52 211 153 / 0.28)` | `rgb(52 211 153 / 0.10)` | Profit/positive |
| `--glow-danger` | `rgb(239 68 68 / 0.28)` | `rgb(239 68 68 / 0.10)` | Loss/risk |
| `--glow-warning` | `rgb(245 158 11 / 0.28)` | `rgb(245 158 11 / 0.10)` | Warnings, gold buttons |

Tailwind: `shadow-glow-primary`, `shadow-glow-cyan`,
`shadow-glow-violet`, `shadow-glow-success`, `shadow-glow-danger`,
`shadow-glow-warning`.

## Elevation

Unchanged from Phase 17 (`--elevation-1/2/3`, `--elevation-highlight`,
`shadow-elevation-1/2/3`). Phase 18 adds depth through colour
(gradients, glows, tints) on top of that shadow scale, not by
changing it.

## Ambient background — the contract

`.app-ambient` is the contract other workers use — do not rename it.
`components/ambient-background.tsx` renders it once, as the first
child of the app shell, `aria-hidden="true"`.

- The layer is `position: fixed; inset: 0; z-index: -1;
  pointer-events: none`, so it sits behind the content and never
  covers text or intercepts taps. (The `z-index: -1` keeps it above
  the canvas/body background but below all content.)
- Three large orbs (42rem) with radial gradients that fall off to
  transparent: blue top-left, violet top-right, cyan bottom.
- An extremely subtle grid (48px, ~3% white lines) masked to fade
  out toward the bottom, so it reads as atmosphere, not graph paper.
- The body background in `globals.css` carries the same idea at a
  smaller scale — three faint radial tints (blue top-left 10%,
  violet right 8%, cyan bottom 7%) over the deep navy base — so no
  page is ever flat solid dark even if `AmbientBackground` is absent.
- The only animation is `.motion-orb-drift`: 70s (95s for the slow
  orb), transform-only, alternating, small range (±32px/−24px).
  It is in the `prefers-reduced-motion` kill list.

Performance approach: depth comes from **gradient falloff, not
`filter: blur` on huge elements** — a blur is a per-frame repaint
cost on mobile, while a radial gradient fading to transparent is
painted once. No WebGL, no Three.js, no heavy framework. The only
backdrop blur in the system is the 14px blur on small glass surfaces
(login card, floating panels), never on a full-screen layer. The
button hover `brightness-110` is a state change on one small element,
not a continuous animation.

## Glass and card surfaces

- `.glass-surface` (new, generic): translucent gradient,
  `backdrop-filter: blur(14px)`, bright top edge, elevation-2.
  The Phase 17 `.card-surface-glass` auth card is unchanged; this is
  the reusable version for floating panels over the ambient
  background.
- `.card-glow-blue/cyan/violet/emerald/danger/amber` (new): use WITH
  `.card-surface` or `.card-surface-raised`. Each adds a tinted
  gradient wash, a matching edge and a soft outer glow. Hover keeps
  the glow and lifts the shadow one level (grouped hover rules keep
  `.card-surface:hover` from dropping the glow).
- `.hero-card` (new): the strongest depth in the system — the navy
  hero gradient, elevation-3, a primary glow, larger radius
  (`rounded-2xl`). One focal card per screen (balance/P&L hero,
  level hero).
- Unchanged and still working: `.card-surface`,
  `.card-surface-raised`, `.card-surface-inset`, `.chart-panel`,
  `.card-surface-glass`, `.list-divider`, `.page-title`,
  `.section-title`, `.metric-value`, `.tnum`.

## Typography scale

One font family for the whole app: **Inter**, via
`next/font/google` in `app/layout.tsx`:

```ts
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-sans",
});
```

The variable class is applied to `<html>`; `globals.css` sets
`body { font-family: var(--font-sans), ui-sans-serif, system-ui, … }`
and `tailwind.config.ts` sets `fontFamily.sans` to the same stack, so
every Tailwind text utility uses Inter too.

### Why Inter

- Designed for UI and screens: excellent legibility at small sizes
  (12–14px secondary text stays readable).
- Tabular figures for financial numbers — money and percentages
  never wobble as they count or update (`.metric-value`, `.tnum`,
  `.metric-hero` all use `tabular-nums`).
- Wide weight range (400–800 in use) covers body, semibold labels,
  bold titles and extrabold hero metrics from one family.
- Neutral, professional, institutional feel with no decorative
  character — it does not fight the trading content.
- No decorative or gaming font: the product is an institutional
  trading system, and the type should read as one.

### Loading and fallback strategy

- `next/font/google` **self-hosts the font at build time**: the
  font files are downloaded during the build and served from the
  app itself. There is no runtime external request, nothing that
  can fail or render-block offline in production, and no
  third-party font host in the CSP path.
- `display: "swap"` means text renders immediately in the system
  fallback and swaps to Inter when it loads — no invisible-text
  flash, no layout shift beyond the (near-identical) system metrics.
- If the `--font-sans` variable is ever missing, the system stack
  (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, sans-serif`) takes over everywhere,
  because both `globals.css` and the Tailwind `fontFamily.sans`
  carry the same fallback.
- No other font family is used anywhere in the app.

### Scale (unchanged from Phase 15, plus Phase 18 helpers)

Page titles 24–32px, section titles 16–20px, primary metrics
24–32px, body 14–16px, secondary 12–14px. Form controls stay 16px
(iOS zoom rule).

| Helper | Definition | Use |
| --- | --- | --- |
| `.metric-hero` | `text-4xl sm:text-5xl font-extrabold tabular-nums tracking-tight` | The single biggest number on a screen (hero balance/P&L) |
| `.metric-value` | `text-2xl sm:text-3xl font-bold tabular-nums` (unchanged) | Stat card metrics |
| `.tnum` | `font-variant-numeric: tabular-nums` (unchanged) | Any money/percentage inline |
| `.text-gradient-blue` / `.text-gradient-ai` / `.text-gradient-gold` | Gradient text via `background-clip: text` | Short display words only (a headline word, a level name) — never body copy, never on a gradient background |
| `.eyebrow` | `text-xs font-semibold uppercase tracking-wider text-muted-foreground` | Small label above a title or metric |
| `.page-title` / `.section-title` / `.page-lede` / `.section-label` | unchanged | As before |

## Primitives (same props/API — no caller changes)

- `components/ui/button.tsx`: `default` is now a gradient primary
  (`bg-gradient-primary`) with a soft shadow, glow + brightness on
  hover, and a 5% press scale. New variants `ai` (`bg-gradient-ai`,
  white text) and `gold` (`bg-gradient-gold`, black text — dark text
  is required for contrast on gold). `secondary` / `outline` /
  `ghost` / `destructive` restyled with layered surfaces and focus
  glow (`focus-visible:shadow-glow-primary`); destructive also gains
  a danger glow on hover. Radius stays `rounded-md` — no
  pill-everywhere. Disabled (`opacity-50`, no pointer events) and
  loading states work as before. Sizes unchanged (44px default,
  40px sm, 48px lg, 44px icon).
- `components/ui/input.tsx`: layered gradient surface
  (`.input-surface`: barely-there vertical gradient so inputs read
  as inset panels) plus a focus glow (ring + `shadow-glow-primary`).
  Height stays 44px, text stays 16px.
- `.input-select` (`globals.css`): same layered surface and focus
  glow as `Input`, for native selects.
- `components/ui/label.tsx`: explicit `text-foreground` so labels
  never inherit a muted colour from a parent; disabled state
  unchanged.
- `components/ui/skeleton.tsx`: behaviour unchanged — the shimmer
  gradient already uses the `--muted` / `--secondary` tokens, so it
  follows the new token system with no edit. Card skeletons now use
  `rounded-xl` so a loading card matches a loaded card's radius.
- `components/ui/badge.tsx` (**new**): `Badge` with variants
  `default` / `profit` / `loss` / `warning` / `info` / `ai` / `gold` /
  `neutral`. Small, semibold, pill, tinted background + matching
  border + coloured text. Text colours are lightened versions of the
  token hues (e.g. `hsl(152 69% 65%)` for profit) so they pass
  contrast on the dark tinted background. Other workers use this for
  strategy/status/P&L badges.
- `.trade-card` (`globals.css`, new): mobile one-card-per-trade base
  — pair, P&L, direction, date, R, status, entry/exit — with
  resting elevation-1 and a hover lift to elevation-2.
- `.list-row-premium` (`globals.css`, new): a single row inside a
  card list — quiet hover surface with a 1px lift and elevation-1
  shadow.

## Accessibility

- Text contrast is unchanged from Phase 15 (same text colours; the
  body tints are 7–10% opacity and the glow washes are 7–9%).
- Gold buttons use black text for contrast on the gold gradient.
- Badge text colours are lightened token hues for contrast on dark
  tints.
- `.motion-orb-drift` is in the `prefers-reduced-motion` kill list
  (animation removed, final state shown); the ambient layer is
  `aria-hidden` and decorative only.
- Focus is visible everywhere (`:focus-visible` ring) and now also
  carries a soft glow on buttons and inputs.

## Verification (local, 2026-10-28)

- Vitest: **336/336 pass** (no new tests — the change is tokens,
  classes and component styling, with no testable logic).
- Typecheck (`npm run typecheck` in `apps/web`): pass.
- Lint (`npm run lint` in `apps/web`): pass.
- Not run, per the brief: `npm run build`, Playwright, dev server —
  the coordinator runs those once at the end to avoid `.next`
  conflicts.

## Real limitation (not claimed otherwise)

The `next/font/google` fetch of the Inter files happens **at build
time**, which this worker did not run (per the brief). Typecheck
confirms the import and the `Inter` options type-check, and
`next/font` self-hosting is the documented behaviour — but the
actual font download and the production build are verified by the
coordinator's build step. If that build runs without network access
to Google Fonts, the font fetch would fail there; the fallback
system stack would still render correctly. The signed-in visual pass
of the new tokens also remains a live-verification item (same open
Phase 14 gap).

## Files changed (Worker 1 only)

- `apps/web/app/globals.css` — Phase 18 tokens, body tints,
  orb-drift keyframes, `.app-ambient` + orbs + grid,
  `.motion-orb-drift`, `.glass-surface`, six `.card-glow-*`
  modifiers + hover rules, `.hero-card`, `.metric-hero`,
  `.text-gradient-*`, `.eyebrow`, `.trade-card`,
  `.list-row-premium`, `.input-select` + `.input-surface`,
  reduced-motion extension.
- `apps/web/tailwind.config.ts` — `cyan`/`violet`/`indigo`/`gold`
  colours, `fontFamily.sans`, `boxShadow` glow tokens,
  `backgroundImage` gradient tokens, `animation.orb-drift`.
- `apps/web/app/layout.tsx` — Inter via `next/font/google` only;
  nothing else changed.
- `apps/web/components/ui/button.tsx` — gradient default, new `ai`
  and `gold` variants, restyled secondary/outline/ghost/destructive,
  focus glow.
- `apps/web/components/ui/input.tsx` — layered surface + focus glow.
- `apps/web/components/ui/label.tsx` — explicit foreground text.
- `apps/web/components/ui/skeleton.tsx` — card skeletons `rounded-xl`.
- `apps/web/components/ui/badge.tsx` — **new** Badge component.
- `apps/web/components/ambient-background.tsx` — **new**
  `AmbientBackground` component (the `.app-ambient` contract).
- `docs/phase-18-tokens.md` — this file.
