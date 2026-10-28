# Phase 18 — App Shell + Auth + Landing (Worker 2)

Status: **implemented and verified locally. Not deployed,
not committed** — deploy + GitHub commit are the parent's
steps, as briefed. (A transient typecheck/lint failure in
another worker's file appeared mid-run and was fixed by
that worker before this worker finished; see
Verification.)

## Scope

Worker 2 of the Phase 18 visual redesign. Files owned and
changed:

- `apps/web/components/app-shell-client.tsx`
- `apps/web/components/auth/auth-card.tsx`
- `apps/web/app/page.tsx` (landing)

Files owned but deliberately unchanged (they inherit the new
language through `AuthCard` and the token variants, and their
behaviour is untouched):

- `apps/web/components/auth/action-form.tsx`
- `apps/web/components/auth/password-input.tsx`
- `apps/web/app/login/page.tsx`, `app/register/page.tsx`,
  `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`
- `apps/web/app/auth/*` (`callback/route.ts` — a server route,
  no visual work)

No other files touched — not `globals.css`, `tailwind.config.ts`,
`components/ui/*`, or `app/layout.tsx` (tokens worker's).

## References — what was taken, and what was not

All five images were read first, before any code changed
(all five have distinct MD5s — no duplicates in this batch):

- `1000042125_6_1mua.jpg` (SHRUHH glass login): **taken** —
  a glass card whose depth comes from a bright top edge and a
  translucent layered surface over a flowing backdrop.
  **Not taken** — the name, logo, purple palette, gradient
  button, wording, or layout.
- `1000042121_7_bv9v.jpg` (delivery app): **taken** — one
  strong hero card in the brand colour, dark secondary cards,
  and a bottom bar with a raised centre `+` action.
  **Not taken** — the delivery domain, the wording, the figures.
- `1000042123_8_e2eu.jpg` (Beyond finance): **taken** — the
  3D ribbon's sense of layered depth and the cards screen's
  hero-card-first hierarchy. **Not taken** — the brand, the
  copy, the card layouts.
- `1000042122_9_7pov.jpg` (Aura AI): **taken** — activity
  cards with a small readable chart inside, generous card
  padding, clear section hierarchy. **Not taken** — the
  purple-gradient app, the voice, the fitness content.
- `1000042120_10_8jkn.jpg` (fintech mobile): **taken** — a
  balance hero card with a sparkline, overview icons, recent
  activity rows, and a floating bottom nav with a raised
  centre action. **Not taken** — the brand, the numbers, the
  exact layout.

Deliberately **not** taken from any reference: no purple
rebrand (navy stays the base; violet/cyan are accents), no
copied branding, logo, text, numbers or exact layouts, no
neon or glow-heavy surfaces, no casino/crypto styling, no
fake badges or fake data.

## What changed per surface

### App shell (`app-shell-client.tsx`)

- The root is now transparent (`min-h-screen lg:flex`, no
  `bg-background`) over one fixed `<AmbientBackground />`
  layer rendered as the first child — every signed-in page
  gets the shared ambient orbs + grid. The body carries the
  layered base gradients, so the transparent root is never
  a flat void.
- **Desktop sidebar:** `glass-surface` (translucent, blurred,
  bright top edge) instead of `bg-card/60`. The ITG tile is
  now a blue→indigo gradient with a soft shadow and a light
  ring; the wordmark uses `.text-gradient-blue` on
  "TraderOS". Active nav items get a gradient indicator bar
  (blue→indigo) plus a gradient-tinted background and a
  subtle inset ring, instead of a flat primary tint. The
  collapsed rail, badge behaviour, collapse persistence,
  navigation order and all aria labels are unchanged.
- **Top header:** `glass-surface` instead of
  `bg-background/95 backdrop-blur`; still slim at `h-14`.
  The notification button is now a glass circle
  (`rounded-full`, translucent card surface, blur, light
  ring, level-1 shadow) with the real unread badge only.
  The Add Trade CTA keeps the gradient primary button
  (default variant) with a level-1 shadow. "More" stays one
  tap away in the mobile header drawer.
- **Drawer:** the panel is now `glass-surface`; the wordmark
  carries the same gradient treatment. Slide/fade behaviour,
  Escape handling, focus handling and aria labels unchanged.
- **Mobile bottom nav:** now a floating glass pill —
  `inset-x-3 bottom-3`, `rounded-2xl`, `glass-surface`,
  level-3 shadow — instead of a full-width strip glued to
  the bottom edge, like the floating pill nav in the
  fintech reference. Safe-area padding is kept
  (`env(safe-area-inset-bottom)`). Active tabs get a soft
  tinted pill behind the icon plus a gradient dot; the
  centre Add Trade action stays a raised 56px gradient
  circle (blue→indigo) with a brighter hover. Home /
  Trades / Add / Analytics / Goals unchanged. The existing
  `pb-24` content clearance still covers the floating bar
  (56px bar + 12px offset < 96px).

### Login / auth (`auth-card.tsx`)

- The page now renders `<AmbientBackground />` (shared
  orbs + grid) plus the existing Phase 16 grid and glow,
  two larger soft orbs (cyan low-left, violet low-right,
  low opacity, drifting on the same slow transform-only
  animation, out of phase), and two faint diagonal light
  streaks rising past the card — the flowing depth of the
  references at a whisper of their intensity. Navy stays
  the base; no SHRUHH branding, wording or layout.
- The ITG tile is a blue→indigo gradient with a light ring;
  the eyebrow uses `.eyebrow`; the wordmark uses
  `.page-title` with `.text-gradient-blue` on "TraderOS".
- The glass card (`.card-surface-glass`) gains a gradient
  hairline along its top edge — the bright edge that makes
  glass read as a raised plane, strongest at the centre.
- The form itself (fields, validation, behaviour, error
  handling, the conditional "not connected" alert) is
  unchanged. Register / forgot / reset pages inherit all
  of this through `AuthCard` with no per-page edits.

### Landing (`app/page.tsx`)

- Renders `<AmbientBackground />`; the header is now a
  `.hero-card` with `.eyebrow`, `.page-title` and the
  gradient wordmark, and `.page-lede` for the intro.
- The three feature cards keep `.card-surface` and gain a
  small gradient icon tile each (blue for Journal, cyan
  for Dashboard, violet for AI Coach — purple only for
  AI). No glow modifier on the three cards: the token
  guidance is one glowing card per view, and the hero
  header already carries the primary glow.
- Copy: the stale Phase 2 footer claiming "Supabase and
  Vercel are not connected yet" is replaced with a timeless,
  honest statement ("your real data only, no demo figures…
  no real trades are executed by this system"). The
  "not connected" alert logic in `AuthCard` is unchanged —
  it still appears only when Supabase is unconfigured.

## Decisions and trade-offs

- **Ambient via the component, not the bare class.** An
  empty `<div className="app-ambient" />` renders nothing:
  the orbs and grid are children rendered by
  `<AmbientBackground />` (tokens worker's component). All
  three surfaces use the component, as the token contract
  instructs.
- **No `ai`/`gold` button variants used here.** The tokens
  worker added them to `components/ui/button.tsx`, but the
  shell and auth need only the gradient primary (`default`)
  plus `outline`/`ghost`; the AI Coach's violet accent is
  expressed through its icon tile, not a button. Nothing
  in this scope needed a gold button.
- **No new animations.** The only motion on these surfaces
  is the existing Phase 16 login drift/grid (transform and
  opacity only) plus the ambient's 70s transform-only orb
  drift; both are killed by the global
  `prefers-reduced-motion` rules. Backdrop blur stays
  confined to header / nav / drawer / glass card.
- **No horizontal overflow.** The floating bottom nav is
  inset (`inset-x-3`) and the grid is unchanged; the shell
  fits 320px by construction (same widths as Phase 17,
  plus the inset). The auth page keeps `overflow-hidden`
  on its root for the oversized glow orbs.

## Deliberately unchanged

No business logic, database, auth, calculation, routing or
security changes. No migrations, no schema changes, no new
dependencies. No fake data, no fake badges, no copied
branding or layouts. Navigation order, drawer behaviour,
collapse persistence, Escape/focus handling, aria labels,
form validation and error handling are all exactly as
Phases 15–17 left them.

## Verification (local, 2026-10-28)

- Vitest: **336/336 pass** (no new tests — the change is
  CSS classes and component composition, with no testable
  logic).
- Typecheck: **pass**. Lint: **pass**.
- No `npm run build`, Playwright, or dev server run, per
  the brief — the coordinator runs those once at the end.

### Transient blocker during this run (resolved, not mine)

While this worker was running, `tsc --noEmit` (`TS17008`)
and ESLint both failed on a single error in a file outside
this worker's scope:
`apps/web/components/trades/advanced-review-form.tsx:59` —
a missing `</div>` for the `<div className="grid gap-4
sm:grid-cols-2">` (12 `<div>` opens, 11 closes). The file
was modified at 2026-10-28 14:47 UTC by another Phase 18
worker (trades). This worker did **not** edit it — it is
outside the owned file list. The owning worker fixed it at
14:54 UTC; typecheck and lint were re-run afterwards and
both pass cleanly, and Vitest was re-run at 14:57 UTC:
336/336. No action needed from the coordinator.

## Real limitation (not claimed otherwise)

The signed-in shell changes (ambient layer, glass sidebar
/ header / drawer, floating bottom nav, gradient active
states) **cannot be rendered locally without a live
Supabase project** — there is no session in the no-Supabase
build, and no login was faked. They are verified by
typecheck (modulo the blocker above), lint, the full
Vitest suite, and the shared tokens/classes proven on the
public pages. **The signed-in visual pass must happen live
after deploy** — the same open Phase 14 gap. The parent
should confirm the ambient layer, the floating bottom nav
and the gradient active states on a real phone after
deploy. The login and landing changes are on public pages
and can be screenshot-checked locally by the coordinator.
