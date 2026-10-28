# Phase 18 Aurora Iteration — Glassmorphism over a Dark Aurora

Status: **implemented and verified locally. Not deployed, not committed** —
deploy + GitHub commit + the production build are the coordinator's steps,
as briefed. This is a token-level iteration on top of the just-finished
Phase 18 navy redesign, not a rebuild: same file ownership, same class
names, same props/APIs, no logic/auth/calculation/routing/security
changes, no migrations, no new dependencies, no fake data.

## The direction

Target stack, judged against at the end:

```
DARK AURORA BACKGROUND → BLURRED COLORFUL LIGHT → FROSTED GLASS
SURFACES → 3D DEPTH/SHADOW → PREMIUM FINTECH CONTENT
```

The test question was: *"Does this look like transparent premium glass
floating over an aurora-lit environment?"* The answer by construction is
yes, with one honest caveat (below): the page base is purple-black with
four aurora orbs and four body tints; no owned surface is an opaque
panel any more — every card, shell surface and hero is a translucent
white gradient (0.05–0.12) through which the aurora stays faintly
visible; blur lives only on the floating surfaces; the strongest glass
is the login card. The remaining solid surfaces in the app are small
controls (pagination links, period pills, calendar day cells, print
buttons use `bg-card` outside this worker's files) — controls, not
cards — and their solid fill is the dark purple `--card`, so they read
as part of the same environment rather than navy panels. A full
signed-in visual pass still needs to happen live after deploy (same
open Phase 14 gap); no screenshot was taken locally.

Deliberately **not** done: no purple takeover — purple-black is the
BACKGROUND, surfaces are glass, violet is the primary accent, blue-cyan
the secondary, magenta a whisper, gold premium-only. No neon, no
chrome/mirror reflections, no gaming purple. Nothing of the SHRUHH
login was copied (no branding, wording or layout).

## Palette mapping — supplied hex → HSL token

Computed with a script (`/tmp/aurora-contrast.mjs`, not kept in the
repo) rather than by eye; every value below was contrast-checked
against the `#100020` background (table in "Contrast decisions").

| Supplied hex | HSL | Token / role |
| --- | --- | --- |
| `#100020` | `270 100% 6%` | `--background` — page base, dark purple-black |
| `#340266` | `270 96% 20%` | `--background-2` — midnight purple, hero bases |
| `#492282` | `264 59% 32%` | Deep violet — hero-card aurora wash (as `rgb(52 2 102 / 0.3)`) |
| `#8B60C7` | `265 48% 58%` | Violet accent — `--gradient-ai` start, glow anchor. As small text it is 4.41:1 (just under AA), so it is **not** used for small text; see the split-violet decision. |
| `#430574` | `274 92% 24%` | Aurora deep purple — ambient orb + body tint |
| `#501E7D` | `272 61% 30%` | Aurora violet — ambient orb + body tint |
| `#6C448D` | `273 35% 41%` | Aurora soft violet — (available; the violet orb uses `#501E7D`) |
| `#81268E` | `293 58% 35%` | `--magenta` — atmospheric only: ambient wisp orb + login wisp + one light streak. Never a surface or button. |
| `#2971A4` | `205 60% 40%` | Aurora blue — ambient orb, body tint, hero wash, `--glow-cyan`. `--cyan` is the lightened `205 60% 55%` (see below). |
| `#101010` | `0 0% 6%` | Near-black — (available; the base is the purple-black instead) |
| `#346CE6` | `221 78% 55%` | `--info`, blue-cyan secondary — `--gradient-cyan` start, `--glow-blue`, `.card-glow-blue` |
| `#0F4CCC` | `221 86% 43%` | Deep blue — (available; gradients use the lighter `#346CE6`) |
| `#BD935F` | `33 42% 56%` | `--gold` — premium only: levels, achievements, certificates, gold buttons (black text 7.32:1) |

Hierarchy: **dark purple-black background / violet primary accent /
blue-cyan secondary accent / magenta small atmospheric accent only /
gold premium-only / emerald profit / red-coral loss-risk / amber
warning / off-white text.**

Derived (not supplied) values, and why:

- `--background-3: 272 30% 13%` — purple-tinted charcoal for tertiary
  surfaces (was navy `220 20% 15%`).
- `--card / --popover: 272 40% 14%` — dark purple base for the few
  solid `bg-card` controls outside the glass classes.
- `--secondary / --accent: 272 30% 17%`, `--muted: 272 28% 16%` —
  purple-tinted darks for pills, tabs, muted surfaces.
- `--cyan: 205 60% 55%` — `#2971A4` lightened 40% → 55% lightness:
  the exact hex is 3.78:1 as text (fails AA), the lightened form is
  6.41:1. Used for data accents and the cyan glow wash.
- `--violet / --ai: 262 83% 68%` — the lightened, text-readable
  violet (5.49:1). See the contrast decision below.
- `--indigo: 232 80% 60%` — the violet→blue bridge in gradients.
- `--foreground: 272 25% 94%`, `--muted-foreground: 270 15% 70%`
  (17.27:1 and 8.81:1 on the background).

## Contrast decisions (the primary-violet split)

Checked with a WCAG script against `#100020` (all ratios :1):

| Pair | Ratio | Verdict |
| --- | --- | --- |
| Foreground on bg | 17.27 | ✓ |
| Muted-foreground on bg | 8.81 | ✓ |
| `--violet`/`--ai` 262 83% 68% as text on bg | 5.49 | ✓ AA normal text |
| `--primary` 262 83% 58% as text on bg | 3.55 | ✗ — **not** used for small text |
| White on `--primary` 262 83% 58% (solid) | 5.67 | ✓ AA |
| White on gradient-primary stops (58% → indigo 55%) | 5.67 / 6.47 | ✓ |
| White on `--gradient-ai` start `#8B60C7` | 4.57 | ✓ (just passes) |
| `#8B60C7` exact as text on bg | 4.41 | ✗ just under AA — not used for small text |
| `#A78BFA` as text on bg | 7.49 | ✓ (the lighten-toward range the brief named) |
| `--cyan` 205 60% 55% as text on bg | 6.41 | ✓ |
| `#2971A4` exact as text on bg | 3.78 | ✗ — hence the lightened `--cyan` |
| `--info` `#346CE6` as text on bg | 4.42 | ✗ just under — never used for small text; badge info text is the lightened `221 70% 75%` (9.19:1) |
| Gold `#BD935F` as text on bg | 7.02 | ✓ |
| Black on gold gradient (56% → 45%) | 7.32 / 5.24 | ✓ |
| Badge texts on their 15% tints | profit 10.78, loss 6.37, warning 9.59, info 8.11, ai 7.27, gold 8.78 | ✓ all |
| Chart tick `#a9adc9` on inset panel | ~7.8 | ✓ |

**The finding the brief anticipated but did not resolve:** no single
violet can be both white-text-readable (solid buttons) and
dark-background-readable (small text). WCAG needs luminance ≤ 0.183
for the first and ≥ 0.195 for the second — impossible. So there are
**two violets on purpose**:

- `--primary: 262 83% 58%` — the darker action violet. White text on
  it is 5.67:1, so the solid `bg-primary` buttons the app already has
  in `trades/page.tsx` and `reports/page.tsx` (outside this worker's
  files), the skip link, and the onboarding progress bar stay
  readable. It is never used for small text on dark.
- `--violet / --ai: 262 83% 68%` — the light violet (5.49:1). This is
  what small violet text uses: the shell's active nav labels and
  bottom-nav active labels switched from `text-primary` to
  `text-violet`, and `.action-link` switched to `text-violet`.
  (A repo-wide grep confirmed `text-primary` appears nowhere else —
  only the shell, `.action-link`, and the button/badge components
  this worker owns.)

The brief's instruction to "lighten toward #A78BFA range if small
text fails" is honoured by the `--violet` value; `--primary` stays
darker because the solid-button usages demand it. Both are documented
in the `:root` comment in `globals.css`.

## The glass system — three levels

One language everywhere: **transparent white surface + very subtle
violet highlight + soft top reflection (`inset 0 1px 0 white/8–16%`)
+ deep shadow underneath.** Frosted glass, not chrome: no mirror
reflections, no hard bright borders — borders are translucent white
(0.14–0.25), which reads as a reflection/highlight, not a line.

| Level | Class | Surface | Blur | Border | Radius | Shadow |
| --- | --- | --- | --- | --- | --- | --- |
| Standard | `.glass-surface` | white 0.08 → 0.05 | 20px | white 0.15 | 20px | elevation-2 |
| Elevated | `.glass-surface-elevated` | white 0.10 → 0.06 | 20px | white 0.20 | 24px | elevation-3 + faint violet glow |
| Hero | `.card-surface-glass` | white 0.12 → 0.07 | 24px | white 0.25 | 24px | elevation-3, clearest highlight |

Plus the two non-blurred card levels (see "Blur budget"):

| Level | Class | Surface | Blur | Border | Radius |
| --- | --- | --- | --- | --- | --- |
| Content | `.card-surface` | white 0.08 → 0.05 | none | white 0.14 | 20px |
| Raised | `.card-surface-raised` | white 0.10 → 0.06 | none | white 0.18 | 20px |

`.hero-card` is the strongest depth in the system: an aurora wash
(violet 0.22 → midnight purple 0.30 → aurora blue 0.18) layered over
Hero glass, 20px blur, 0.25 border, 24px radius, elevation-3 + violet
glow. One focal card per screen.

Inset surfaces (`.card-surface-inset`, `.chart-panel`) are the
inverse: a translucent purple-black pool (`rgb(16 0 32 / 0.45 → 0.35)`,
border white 0.10) set *into* the glass, so charts and inner panels
read deeper than the card above them.

Radius rule: glass surfaces are 20–28px; small controls (inputs,
buttons, pills, badges) keep their existing radius — nothing was
pilled. `.trade-card` and list rows follow the content-card values.

**Readability call:** no glass surface was darkened beyond its level
— the orbs behind the cards are dark (≤ 0.30 opacity, falling to
transparent) and the body tints are ≤ 0.22, so off-white text on
white-0.08 glass still measures 17.27:1 in the worst case. If a live
check ever shows a card sitting over a bright orb, the fix is the
documented one: darken that surface's background until it reads —
the levels are values, not dogma.

## Blur budget + performance strategy

- **backdrop-filter lives only on floating/glass surfaces:** header,
  sidebar (Standard), drawer, bottom dock (Elevated), auth card
  (Hero), hero cards, modals. That is ~6 blurred surfaces per view
  at most, all small or single-purpose.
- **Ordinary content cards keep the translucent gradient WITHOUT
  backdrop-filter.** A blur on every card is a per-frame repaint
  cost on mobile; the alpha gradient alone still shows the aurora
  through, because the card composites over the body/ambient layers.
- **One large background layer, not dozens of animated elements:**
  `AmbientBackground` renders four 42rem-or-smaller orbs + one grid
  in a single fixed layer; the only animation is a 70s/95s
  transform-only drift (killed by `prefers-reduced-motion`). The
  login adds three more large blurred orbs and two streaks, all
  transform/opacity only. No `filter: blur` on any huge element —
  depth comes from radial-gradient falloff, painted once.
- **Fallback:** `@supports not ((backdrop-filter: blur(1px)) or
  (-webkit-backdrop-filter: blur(1px)))` gives every blurred surface
  a much more opaque purple fill (0.96–0.97 alpha) instead of the
  translucent wash, so glass stays readable in browsers without
  backdrop-filter (old Safari, some embedded webviews). The aurora
  behind is sacrificed; the content is not. Verified present in the
  compiled CSS (see Verification).
- Buttons: secondary/outline/ghost use a *small* `backdrop-blur-sm`
  on a translucent white fill — small elements, one blur each, and
  only where the button sits over glass. Primary/ai/gold/destructive
  stay solid gradients (no blur, no transparency) so the primary
  action is always obvious.

## What changed per surface

### Foundation (`globals.css`, `tailwind.config.ts`)

- Retokened `:root` to the aurora palette (table above). **Every
  token/class name still works** — values changed, names did not.
  `--border` / `--input` are now translucent white *inside the
  token* (`0 0% 100% / 0.16` and `/ 0.22`), so `hsl(var(--border))`
  still resolves everywhere; a repo grep confirmed nothing uses
  `hsl(var(--border) / …)` with a second alpha.
- Body tints: four aurora radials (deep purple / violet / aurora
  blue / magenta whisper) over the purple-black base.
- Glows: `--glow-primary` and `--glow-violet` are violet
  (`rgb(167 139 250)`); new `--glow-blue` is `#346CE6`; `--glow-cyan`
  is `#2971A4`. Tailwind gains `shadow-glow-blue` and a `magenta`
  colour.
- Gradients: primary violet → indigo; AI starts at `#8B60C7`;
  cyan is `#346CE6` → `#2971A4`; gold is the `#BD935F` family;
  hero is the aurora sweep. `.text-gradient-blue` keeps its name
  for compatibility but now renders the violet primary gradient
  (noted in its comment).
- `.card-glow-*` modifiers now layer their tinted wash **over** the
  glass base gradient (previously the wash replaced the card
  background, which would have left glow cards near-transparent
  under the new translucent base). Blue = `#346CE6` secondary,
  cyan = aurora blue, violet = primary; emerald/danger/amber stay
  semantic. `.hero-card` gained a `:hover` rule that keeps its
  violet glow (`.card-surface-raised:hover` would otherwise drop it).

### Ambient (`ambient-background.tsx`, `.app-ambient*`)

- Four orbs, aurora palette: deep purple `#430574` top-left (0.30),
  violet `#501E7D` top-right (0.22), **magenta `#81268E` wisp**
  bottom-right — half-size (26rem), faintest (0.14), atmospheric
  only — aurora blue `#2971A4` bottom (0.18). Extremely subtle grid
  unchanged; slow transform-only drift unchanged; reduced-motion
  kill list unchanged. The old `orb-cyan` class is gone (renamed,
  component + CSS updated together).

### Shell (`app-shell-client.tsx`)

- Sidebar and header: Standard glass (`.glass-surface`) with the new
  tokens. Drawer and bottom dock: Elevated glass
  (`.glass-surface-elevated`).
- **Bottom dock floats:** Elevated glass, inset `inset-x-3 bottom-3`,
  24px radius, deep shadow + faint violet glow, safe-area padding
  kept. Active tab: light-violet text + violet-tinted pill + violet
  gradient dot (violet active glow). Centre Add Trade: raised
  violet → indigo gradient circle (`bg-gradient-primary`).
- ITG tile: `bg-gradient-ai` (violet `#8B60C7` → indigo). Active nav
  indicator bar: violet → indigo gradient. Active nav text:
  `text-violet` (readable; see the split-violet decision).
- Notification button: glass circle (`bg-white/[0.08]`, blur,
  white 0.15 ring). Nav order, drawer behaviour, collapse
  persistence, Escape/focus, aria labels, safe-area padding —
  unchanged.

### Login (`auth-card.tsx`) — the strongest aurora example

- Dark purple-black + large blurred violet/blue/magenta aurora
  lights: violet overhead glow (with a magenta hint), aurora-blue
  wash low-left, violet wash low-right, small magenta wisp
  top-right — all slow transform-only drift, out of phase.
- Hero glass card (`.card-surface-glass`, 24px blur), violet
  gradient hairline on the top edge, violet → indigo ITG tile,
  gradient wordmark. Grid lines are violet-tinted now.
- Two faint diagonal light streaks (violet/magenta right,
  aurora-blue left). Form, validation, behaviour untouched. No
  SHRUHH branding, wording or layout copied.

### Buttons / badges (`ui/button.tsx`, `ui/badge.tsx`)

- Primary: violet → indigo gradient (token change only), violet
  focus glow. `ai` stays violet-family (`#8B60C7` → indigo).
  `gold` stays gold (`#BD935F` family, black text).
- Secondary / outline / ghost join the glass system: translucent
  white (`0.08` / `0.06` / hover `0.10`) with a small blur and a
  white 0.15 border where a border exists. Primary actions keep
  the strong gradient so they stay obvious — not every button is
  transparent.
- Badge `default`: gradient primary with white text (a solid light
  violet would fail contrast at 3.67:1; the gradient stops pass at
  5.67/6.47). `info` and `gold` texts moved to the aurora palette
  (`221 70% 75%`, `33 45% 70%`). Same props/API.

### Charts (`analytics/charts.tsx`)

- Tooltip/grid/axis colours only: dark purple glass tooltip
  (`rgba(26, 12, 40, 0.92)`, white 0.18 border, 12px blur, deep
  shadow), faint violet-tinted grid (`#2b2640`, dashed, 0.5),
  violet-tinted tick labels (`#a9adc9`, ~7.8:1), violet-tinted
  hover cursor (`#3a3252`). **Series colours unchanged**
  (green `#34d399`, red `#f87171`, blue `#60a5fa`/`#3b82f6`,
  violet `#a78bfa`) and all data logic untouched.

## Verification (local, 2026-10-28)

- Vitest: **336/336 pass** (36 files), unchanged — the change is
  tokens, classes and component styling, with no testable logic.
- Typecheck (`npm run typecheck` in `apps/web`): **pass**.
- Lint (`npm run lint` in `apps/web`): **pass**, 0 errors.
- Tailwind compile check (not the production build): `npx
  tailwindcss -i app/globals.css` compiles cleanly; the output
  was inspected to confirm `.card-surface` is the translucent
  gradient with **no** backdrop-filter, `.hero-card` /
  `.glass-surface*` carry `blur(20px)`/`blur(24px)`,
  `--border: 0 0% 100% / 0.16` resolves through
  `hsl(var(--border))`, and the `@supports not
  (backdrop-filter…)` fallback block is present.
- Leftover-colour sweep: grep over all eight owned files for
  `hsl(217…)` / `hsl(222…)` / navy hex / `blue-400/500` /
  `cyan-500` / `violet-500` / `indigo-500/600` / `app-ambient-orb-cyan`
  returns only the intentional `#346CE6` blue-cyan values
  (`hsl(221 78% 55%)` in the cyan gradient, the blue glow wash,
  and the badge info text).
- Not run, per the brief: `npm run build`, Playwright, dev server —
  the coordinator runs those once at the end.

## Real limitation (not claimed otherwise)

The signed-in visual pass — glass over aurora on a real phone, the
floating dock, the hero cards with real positive/negative data —
**cannot be rendered locally without a live Supabase project** and
was not screenshot-checked. Verification is Vitest, typecheck, lint,
the Tailwind compile inspection, and the contrast arithmetic above.
**The signed-in visual pass must happen live after deploy** — the
same open Phase 14 gap. The production build was also not run by
this worker, per the brief; the coordinator's build step is the
first place the new tokens are compiled in Next.js.

## Files changed

- `apps/web/app/globals.css` — aurora retoken, body tints, glass
  system (3 levels + content/raised + hero), aurora orbs, glow
  modifiers, hero card, trade card, list rows, inputs, action
  link, `@supports` backdrop-filter fallback.
- `apps/web/tailwind.config.ts` — `magenta` colour, `glow-blue`
  shadow, updated comments.
- `apps/web/components/ambient-background.tsx` — four aurora orbs
  (purple / violet / magenta wisp / blue).
- `apps/web/components/app-shell-client.tsx` — glass levels, violet
  active states, gradient tile, floating glass dock.
- `apps/web/components/auth/auth-card.tsx` — aurora login (strongest
  example): violet/blue/magenta lights, hero glass card, streaks.
- `apps/web/components/ui/button.tsx` — glass secondary/outline/
  ghost; gradient primary/ai/gold unchanged in API.
- `apps/web/components/ui/badge.tsx` — gradient default, aurora
  info/gold texts.
- `apps/web/components/analytics/charts.tsx` — glass tooltip,
  violet-tinted grid/ticks/cursor; series colours unchanged.
- `docs/phase-18-aurora.md` — this file.
