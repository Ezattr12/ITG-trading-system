# Phase 17 — Premium Visual-Depth Refinement

Status: **implemented and verified locally. Not deployed, not committed** —
deploy + GitHub commit are the parent's steps, as briefed.

## What this phase is

A refinement of the Phase 15 institutional design and the Phase 16
motion layer, inspired by six reference images Ezat supplied. It is
not a rebuild and not a rebrand: the navy/charcoal design system,
the blue/indigo brand accent, the semantic colours and the motion
system are all unchanged. What changed is depth — how surfaces
layer, how the eye finds the most important card, and how the
primary action presents itself on mobile.

## The references — what was taken, and what was not

Six files were read first, before any code changed:

- `1000042121_0_96gw.jpg` (delivery app): **taken** — one strong
  hero card in the brand colour, dark secondary cards, status
  chips, clean separated list rows, and a bottom bar with a
  raised centre `+` action. **Not taken** — the delivery
  domain, the blue-everything palette, the wording, the figures.
- `1000042122_1_2x0y.jpg` (Aura AI concept): **taken** — activity
  cards with a small readable chart inside, day pills, a history
  list with separated rows, generous card padding. **Not taken**
  — the purple gradient app, the "wave of productivity" voice,
  the fitness content.
- `1000042124_2_lmhs.jpg` and `1000042123_3_756a.jpg` (SHRUHH
  login): **taken** — a glass card whose depth comes from a
  bright top edge, a translucent layered surface and a soft
  shadow over a flowing backdrop. **Not taken** — the name, the
  logo, the purple palette, the gradient button.
- `1000042125_4_dm4m.jpg` ("Beyond" finance app): **not actually
  supplied** — this file is byte-identical to
  `1000042124_2_lmhs.jpg` (same SHA-256), i.e. a duplicate of
  the SHRUHH login, not a separate finance reference. Nothing
  was taken from it beyond the login notes above, and no
  finance-app layout was copied from it.
- `1000042126_5_d41v.jpg` (BitTorrent sidebar): **taken** — the
  expanded rail with icon + label + active bar, and the
  collapsed rail that stays elegant: icons, the same active
  bar, and badge counts still visible on the icons. **Not
  taken** — the brand, the grey 3D wallpaper, the menu items.

Deliberately **not** taken from any reference: no purple rebrand
(the references are mostly purple; the ITG system keeps purple
only for AI/intelligence), no copied branding, logo, text,
numbers or exact layouts, no neon or glow-heavy surfaces, no
casino/crypto styling, no fake badges or fake data.

## Quality gaps found before changing anything

1. No elevation scale — `.card-surface` was flat at rest (border
   only, no shadow); every card sat at one depth.
2. No hero emphasis — the primary KPI looked identical to every
   other card, so nothing visually dominated the dashboard.
3. The auth card was a single border plus `shadow-lg`, with no
   layered depth.
4. The bottom bar was five equal tabs; Add Trade — the most
   important workflow — had no prominence on mobile.
5. The collapsed sidebar hid the unread badge entirely.
6. List rows had no separators or hover surface.
7. Charts sat directly on the card surface with no inset panel.

## The elevation system (shared layer first)

New tokens in `app/globals.css` (`:root`):

- `--elevation-1` — resting card: `0 1px 2px` + `0 4px 16px`.
- `--elevation-2` — lifted / hero card and hover: `0 2px 4px` +
  `0 10px 28px`.
- `--elevation-3` — modal / drawer / glass surface: `0 4px 8px`
  + `0 18px 44px`.
- `--elevation-highlight` — a 1px light edge inside the border
  (`inset 0 1px 0 rgb(255 255 255 / 0.05)`), which is what
  makes a dark surface read as a raised plane.

Mirrored as Tailwind `boxShadow` tokens in `tailwind.config.ts`
(`shadow-elevation-1/2/3`) for one-off surfaces (sidebar,
bottom bar, drawer, raised action button).

Shared classes in `globals.css` (`@layer components`):

- `.card-surface` — now carries resting elevation-1 plus the
  top highlight; hover lifts to elevation-2 with a brighter
  border. Still no translate, so nothing shifts. This one
  change lifts all 32 files that use the class.
- `.card-surface-raised` — hero level: slightly lighter surface
  (`hsl(222 26% 16%)`), brighter edge, elevation-2 at rest,
  elevation-3 on hover. Used sparingly: the Current P&L KPI
  and the dashboard Performance chart section.
- `.card-surface-inset` / `.chart-panel` — a darker surface
  set *into* a card, no shadow. Every Recharts component now
  renders inside a `.chart-panel`, so charts read as panels
  set into their cards.
- `.card-surface-glass` — the auth card only: translucent
  gradient, `backdrop-filter: blur(14px)`, brighter edge,
  elevation-3.
- `.list-divider` — `divide-y divide-border` for separated
  list rows inside cards.

## What changed per area

- **Cards (all pages):** resting elevation everywhere via
  `.card-surface`; no per-page colour or shadow changes.
- **Dashboard:** Current P&L is the raised hero KPI
  (`StatCard raised`); the Performance section is raised;
  the equity chart sits in an inset panel; Recent trades and
  Recent activity lists use `.list-divider` with `py-3` rows.
- **Charts (all five Recharts components):** wrapped in
  `.chart-panel`. Dashboard, Analytics and Progress chart
  cards inherit this with no per-page edits.
- **Login:** `AuthCard` uses `.card-surface-glass`, the ITG
  tile sits above the title as the brand mark, and the
  Phase 16 glow + grid backdrop is unchanged. The form,
  validation and behaviour are untouched.
- **Bottom navigation:** the bar is now Home, Trades, a raised
  centre **Add Trade** action, Analytics, Goals. The centre
  action is a 56px primary circle lifted above the bar
  (`-translate-y-4`, `ring-4 ring-background`,
  `shadow-elevation-3`, press scale, `aria-label="Add trade"`,
  visible "Add" caption). "More" leaves the bar but stays one
  tap away: the mobile header menu already opens the drawer
  with the full navigation. The bar itself carries an
  elevation-2 top shadow so it lifts off the content.
- **Sidebar:** the collapsed rail now shows the real unread
  count as a small badge on the Notifications icon (it was
  hidden when collapsed); the active bar, the ITG tile and
  the collapse animation are unchanged. The rail carries a
  soft elevation-1 shadow. No fake badges were added.
- **Drawer:** shadow unified to `shadow-elevation-3`.
- **Lists:** dashboard Recent trades / Recent activity use
  separated rows. Notifications rows already used
  `.card-surface`, so they inherit the new elevation with no
  edit. Trades table rows already had dividers and hover.

## Spacing and hierarchy polish

No spacing scale changed: the Phase 15 rhythm (`p-4 sm:p-6`
cards, `mt-6 sm:mt-8` sections, `gap-3 sm:gap-4` KPI grid)
was audited and is consistent. The polish is depth, not
spacing — the one spacing-adjacent change is the bottom
bar's raised centre button, which the existing `pb-24`
content clearance already accommodates (bar 56px + ~28px
of raised circle above it < 96px of clearance).

## Motion (Phase 16) — intact

Depth is static (shadows and borders), so it cannot fight
the motion system. Hover transitions already run through the
shared motion tokens and are killed by the global
`prefers-reduced-motion` rule, which also covers the new
press scale on the centre action. No new animation was added.

## Accessibility

- The centre Add action is a real link to `/trades/new`
  with `aria-label="Add trade"` and a visible "Add" caption;
  it is a 56px touch target.
- The collapsed badge is decorative duplication of the
  expanded badge; the count is announced through the
  existing `aria-label` on the Notifications link in the
  header.
- Contrast is unchanged (same text colours); the raised
  card's lighter surface keeps text contrast identical.
- `prefers-reduced-motion` behaviour is unchanged.

## Verification (local, 2026-10-28)

- Vitest: 336/336 pass (no new tests — the change is CSS
  classes and one boolean prop, with no testable logic).
- Typecheck: pass. Lint: pass. `next build`: pass, 30 routes.
- Playwright: 36/36 pass (6 smoke + 15 responsive + 15
  motion). No new Playwright tests were added: the bottom-nav
  centre action and the collapsed sidebar badge live in the
  signed-in shell, which cannot be rendered locally without
  a live Supabase project (see limitation below).
- Screenshots inspected at 320 / 360 / 390 / 430 / 768 /
  1280px of the landing page and the login page: no
  horizontal overflow anywhere, glass card and ITG tile
  render as intended, landing cards carry the new resting
  elevation.
- `scripts/security-check.mjs`: pass.

## Deliberately unchanged

No business logic, database, auth, calculation or trading
behaviour changed. No migrations, no schema changes, no new
dependencies. No fake data, no fake badges, no copied
branding or layouts. The design tokens, colour system and
motion system are exactly as Phases 15–16 left them.

## Real limitation (not claimed otherwise)

The signed-in depth changes (raised KPI and Performance
cards, inset chart panels, bottom-nav centre action,
collapsed sidebar badge, divided dashboard lists) **cannot
be rendered by Playwright locally without a live Supabase
project** — there is no session in the no-Supabase build,
and no login was faked. They are verified by build,
typecheck, lint, the full Vitest suite, the shared
tokens/classes proven on the public pages (landing/login
screenshots), and the Playwright responsive suite. **The
signed-in visual pass must happen live after deploy** — the
same open Phase 14 gap. The parent should confirm the
centre Add action, the raised hero cards and the collapsed
badge on a real phone after deploy.

## Deployment (2026-10-28, deployer phase)

- Status: **deployed to production.** Live URL: https://itg-traderos.vercel.app
- Deployment: `dpl_EqjSATjsq8gp12Qd9XiD1Gy8SF8E`, target `production`, state **READY**
  (created 2026-10-28 14:06 UTC; deployment URL
  `itg-traderos-8mvofv6mp-ezattr12s-projects.vercel.app` also 200).
- Previous production deployment `dpl_AePFWSCjewsRq4AXb7TqvTqCXdvJ` (Phase 16) is superseded;
  confirmed via `list_deployments` that the new deployment is the latest production one.
- Live checks (curl, 2026-10-28 14:09 UTC): `/` → 200 (real landing
  page, "ITG TraderOS"); `/login` → 200 (real login form); `/dashboard` signed out → 307 to
  `/login?next=%2Fdashboard`; all six Phase 11 security headers present
  (CSP, HSTS, X-Content-Type-Options nosniff, X-Frame-Options DENY,
  Referrer-Policy, Permissions-Policy).
- Staging tree rebuilt from the current repo at
  `~/workspace/.itg-deploy-staging/` following the Phase 13 recipe
  exactly, now via the saved `rebuild.sh` (rsync + vendor + patch +
  lockfile regenerate/split): `apps/web` rsynced (no node_modules,
  `.next`, `*.test.ts`, `.env`), `packages/calc/src/index.ts` vendored to
  `apps/web/lib/calc/index.ts`, tsconfig `@itg/calc` remapped,
  `@itg/calc` removed from `package.json` with all direct deps pinned
  to the exact versions in the repo root `package-lock.json`,
  `transpilePackages` removed from `next.config.ts`,
  `package-lock.json` regenerated by `npm install --package-lock-only`
  (221,856 bytes, 4 chunks, roundtrip verified) and validated locally
  (`npm install` + `npm run build` — "Compiled successfully", 30 routes).
  162 files uploaded via the SHA-addressed `upload.py`. No recipe
  differences: Phase 17 added no new dependencies and no migrations.
- One deploy attempt failed first and is recorded honestly:
  the first `create_deployment` returned 403 "Not authorized: Trying
  to access resource under scope \"ezattr12s-projects\"" because
  `teamId` was passed explicitly. Fix: retry the identical call
  without `teamId` — the scope is inferred from the project — and it
  deployed cleanly on the first retry (no file re-upload needed).
  Future deploys must NOT pass `teamId` to `create_deployment`.
  (The suggested `authorize_team_access` remediation does not exist
  in this connector's tool list; it was not needed.)
- Env vars unchanged (Supabase URL, anon key, service-role key, app
  URL from Phase 13). No Supabase data or migrations touched.
- Open gap (unchanged): the signed-in live visual pass of the
  depth changes cannot run from the VM (known limitation, Phase 14 gap);
  it needs a real browser session or Ezat's own inspection on a
  phone. The live checks above prove the new build serves, not that
  every signed-in screen renders correctly on mobile.
