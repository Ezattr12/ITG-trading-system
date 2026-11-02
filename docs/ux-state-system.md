# UX State System — ITG TraderOS (web)

Task 10 deliverable. This document inventories every loading, empty,
error, success, destructive and offline state in the web app, names the
canonical v2 presentation for each pattern, and records what Task 10
changed (the shared state layer) and what it deliberately did not.

Scope rule: the state system is a **visual language**, not a new
interaction model. Task 10 unified the shared components' presentation
in the v2 design system. It introduced no toast framework, changed no
flow, no copy, no timing and no behaviour, and touched no file under
`lib/`.

---

## 1. Loading

### Route loading — one shared skeleton

Every route-level loading state renders the same component:
`PageSkeleton` in `apps/web/components/ui/skeleton.tsx`. Six routes
have a `loading.tsx`, and all six are identical wrappers:

| Route | File |
| --- | --- |
| `/dashboard` | `app/dashboard/loading.tsx` |
| `/trades` | `app/trades/loading.tsx` |
| `/analytics` | `app/analytics/loading.tsx` |
| `/levels` | `app/levels/loading.tsx` |
| `/notifications` | `app/notifications/loading.tsx` |
| `/coach` | `app/coach/loading.tsx` |

There are **no bespoke route loaders** — nothing to align. The
remaining routes (`/profile`, `/goals`, `/risk`, `/plan`, `/calendar`,
`/progress`, `/achievements`, `/certificates`, `/reports`,
`/psychology`, `/reviews/weekly`, `/onboarding`, `/trades/new`,
`/trades/[id]`, `/trades/[id]/edit`, the admin suite and the auth
pages) have no `loading.tsx`; navigation to them waits on the server
component and the shell paints around the streamed content.

`PageSkeleton` shape (unchanged geometry since Phase 16): a title bar,
a lede bar, a grid of 4 card blocks (`h-28`), and one large panel block
(`h-64`). Skeletons are `aria-hidden`, carry no words and no numbers —
nothing fake is ever rendered as if it were data.

Anatomy of the shimmer:

- `.skeleton` (in `@layer components` in `app/globals.css`) supplies
  the sweep: a `linear-gradient` over the `--muted` / `--secondary`
  tokens animated by the `motion-shimmer` keyframes (1.6s). Both
  tokens were rebalanced to deep blue in the v2 foundation
  (`--muted: 222 36% 11%`, `--secondary: 222 38% 13%`), so the flat
  bars already read deep blue.
- **Task 10 addition — `.itg2-skeleton`** (in `app/itg2.css`): the
  card and panel blocks of `PageSkeleton` now also carry this class,
  which gives them the L1 glass treatment identical to `.itg2-card` —
  same border (`rgba(120, 175, 255, 0.16)`), same layered deep-blue
  gradient, the inset top-edge light, the card shadow, and the 24px
  v2 card radius. The shimmer sweep becomes the first background
  layer (sized 200% so the keyframes can travel it); the glass
  gradient beneath is sized 100% and does not move. The title and
  lede bars stay flat `.skeleton` — they stand in for text, not for
  cards.
- Reduced motion: the global `prefers-reduced-motion` block (in
  `app/itg2.css`) sets `.skeleton { animation: none !important }`, so
  the glass skeleton is static for reduced-motion users, exactly as
  the flat one was. No new motion behaviour was added.

### In-component pending states

No `<Suspense>` fallbacks exist anywhere in `app/` or `components/`.
Pending is expressed inside the control that started the work:

| Surface | Pattern |
| --- | --- |
| Shared `ActionForm` (`components/auth/action-form.tsx`) | Submit disables, `aria-busy`, `Loader2` spinner + "Please wait…" |
| Edit Trade form (`components/trades/edit-trade-form.tsx`) | `Loader2` spin inside the confirm/save buttons while pending |
| Delete Trade dialog (`components/trades/delete-trade-dialog.tsx`) | Danger submit disables, spinner + "Removing…" |
| Avatar upload (`components/profile/avatar-upload.tsx`) | Spinner replaces the camera affordance while uploading |
| Coach refresh form / chat (`components/coach/*`) | Pending states local to those components |

The shared `ActionForm` is the canonical form-pending pattern. It is
shared by design and Task 10 did not edit it.

---

## 2. Empty states

Canonical pattern (already uniform across the converted pages; Task 10
verified zero v1 classes remain anywhere in `app/`): an honest
sentence on a v2 card — never a fabricated row, never a zero dressed
up as data — usually with the next action as a link or button.

Principal instances:

| Surface | State |
| --- | --- |
| Trades list | "No trades match" on `.itg2-card-elevated`, copy differs for *no trades at all* vs *filters exclude everything* |
| Dashboard | "No trades yet — add your first trade and your performance will be calculated from it.", "No goals yet.", "No activity yet — achievements, risk milestones and coach insights will appear here as they happen." |
| Notifications | "No notifications yet." |
| Psychology | "No data yet — record emotion, confidence and discipline in …" |
| Goals / Progress | "No goals yet. …" with the create path named |
| Calendar | "No trades yet — your calendar will fill in as you journal trades." Blank days stay blank — never zero-P&L tiles |
| Levels | Per-dimension "No data yet": unmeasurable dimensions are excluded from the score, never scored 0 |
| Coach | Insufficient-data state (page and chat): the coach states it needs a minimum of trades before it will analyse — insufficient data is never narrated |
| Analytics / Reports | Analyzer minimums gate statements (group rankings need ≥3 trades, headline analysis ≥5); below them the sections show their insufficient states instead of invented findings |
| Certificates | Eligibility is evaluated for the current month only, criteria listed with met/unmet markers; the issued list has its own honest empty state |

Empty states are presentation of a true fact (no data), so they were
already converted page by page in Tasks 1–9. Task 10 changed none of
them.

---

## 3. Error states

Three boundaries, all Phase 27, all now v2 in presentation (Task 10):

| Boundary | File | When | Recovery offered |
| --- | --- | --- | --- |
| Route error | `app/error.tsx` | A page segment throws during render/action | "Try again" (`reset()` re-renders the segment) |
| Root-layout error | `app/global-error.tsx` | The root layout itself fails | "Reload" (full reload via `reset()`) |
| Not found | `app/not-found.tsx` | Unknown route, or a gated area denying via `notFound()` (e.g. the admin gate) | "Go to dashboard" link |

Presentation after Task 10:

- `error.tsx` and `not-found.tsx`: the message sits in an
  `.itg2-card.itg2-card-flat` glass panel (`p-8`, centred, max-w-md);
  the 404 kicker uses `.itg2-eyebrow`; the recovery action is
  `.itg2-btn-primary`. Copy, the error `digest` rendering (a
  correlation reference, never a stack trace) and the `reset`
  behaviour are byte-identical to before.
- `global-error.tsx` renders its own `<html>`/`<body>` because the
  root layout has failed — it cannot use globals.css, Tailwind or
  the self-hosted font, by design. Task 10 changed **only the inline
  palette literals** to the v2 values: background `#04060C`
  (was `#0d0217`), foreground `#F4F8FF` (was `#efeaf6`), button
  `#1268D8` (was the violet `#7c3aed`). Structure, copy, digest and
  reload behaviour are unchanged, and its independence is intact.

Form-level errors are not part of the boundaries: the shared
`ActionForm` renders the action's error in its red semantic box
(`role="alert"`) inline above the submit — the established rendering
on every form that uses it (see §4).

---

## 4. Success / feedback — the four established patterns

Task 9's inventory, verified complete by Task 10 (grep over
`searchParams` consumers and `useActionState` forms). There is **no
toast system** anywhere, and Task 10 did not add one: these four
patterns are the system.

1. **Shared ActionForm inline boxes** — `useActionState` forms render
   the result inline: red box (`role="alert"`) for errors, emerald
   box (`role="status"`, `CheckCircle2` icon) for success messages.
   Used by profile, onboarding, trades, risk, discipline and admin
   forms. Deliberately shared and unchanged — converted pages keep
   this semantic rendering by design.
2. **Redirect query params consumed by the target page** — the
   action redirects, the landing page renders a notice:
   - `?deleted=1` → Trades list: `.itg2-notice.itg2-notice-success`
     "Trade removed successfully."
   - `?saved=1` → Trade detail: `TradeSavedBanner`
     (`.itg2-notice.itg2-notice-success`, animated checkmark,
     dismissible)
   - `&shot=failed` → Trade detail: `.itg2-notice.itg2-notice-warning`
     "Screenshot not attached. Your trade was saved…" with the retry
     path named
   - `?done` → Onboarding: `.itg2-notice.itg2-notice-success`
     "Onboarding saved…"
   (For contrast, `?period`, `?month`, `?type`/`date`/`report` on
   Analytics, Calendar and Reports are *view state*, not feedback.)
3. **Standalone `useActionState` forms with inline state lines** —
   forms that do not use the shared ActionForm render their own
   one-line result under the form (mark-read forms, certificate
   issue form, weekly review form). In v2 these lines use
   `.itg2-text-profit` / `.itg2-text-loss`.
4. **Page-level `.itg2-notice-*` banners** — state and confirmation
   messaging that belongs to the page rather than a form
   (not-configured warnings, saved confirmations, status banners).
   Variants: `-success`, `-warning`, `-neutral`. Used across 14 files
   (pages and components).

Pattern choice is historical per form; the vocabulary within each
pattern is consistent. Unifying the *interaction model* (e.g. adding
toasts) would be a product change, not a state-visual task, and is
out of scope here.

---

## 5. Destructive confirmations

Nothing destructive in ITG TraderOS hard-deletes a financial record:
per the trade lifecycle, open trades **cancel**, closed trades are
**voided by reversal**, and the record plus its audit row are
preserved. The confirmations say so. Two confirmation patterns plus
one reason-gated form exist:

| Surface | Pattern | Wording / semantics |
| --- | --- | --- |
| Delete trade (`components/trades/delete-trade-dialog.tsx`) | Modal dialog | "Delete trade?" + what happens ("removed from your active trading journal, dashboard and analytics. Its financial history and audit record will be preserved"), a summary of the trade, an optional reason select, ghost "Cancel" + `.itg2-btn-danger` "Delete trade" |
| Cancel trade, delete screenshot (`components/trades/confirm-button.tsx`, trade detail + edit pages) | Two-step arm (Phase 3) | First click arms: label becomes "Click again to cancel" / "Click again to delete"; second click submits. No `window.confirm`. Danger variant `.itg2-btn-danger` (armed state brightens), screenshot variant `.itg2-btn-ghost` |
| Revoke certificate (`components/admin/admin-forms.tsx`) | Reason-gated form | No two-step arm: a **required reason field** is the gate, with the note "Revoking is permanent for this certificate and is recorded in the audit log." and a `.itg2-btn-danger` submit |

Consistency assessment: confirm buttons always carry the action's own
verb phrase ("Delete trade", "Revoke certificate"; the arm pattern's
labels likewise). Every surface states the consequence honestly —
what is preserved, or that the action is permanent — and every one of
these writes an audit row server-side. Goals have no delete (status
changes only, non-destructive). Admin user/verification actions are
reason-gated forms of the same family as certificate revoke.

---

## 6. Offline / connectivity — the reality

**There is no offline support, and Task 10 did not build any.**

Evidence (grep over `app/`, `components/`, `lib/`, `public/` and both
`package.json` files):

- No service worker: no registration, no `sw.js`, no workbox /
  next-pwa dependency.
- No `navigator.onLine` checks and no `online`/`offline` event
  listeners anywhere.
- No connectivity retry UI; a failed request surfaces through the
  normal form error boxes or the route error boundary (§3).
- `public/manifest.webmanifest` exists and is referenced from the
  root layout metadata — install metadata only. Its `icons` array is
  empty and its `theme_color` / `background_color` are the v1-era
  `#0b0e11`. It confers no offline capability.

The app requires connectivity (all data is per-user and RLS-scoped in
Supabase; there is no local data layer on web). Offline support is a
feature decision with real design consequences (what may be cached,
how journaling would queue and reconcile), not a state-visual task —
it is recorded here as an explicit non-goal of Task 10 for a future
product decision.

Mobile note (for completeness, out of this task's web scope): the
Expo app likewise has no offline queue; its data flows through
`/api/mobile` with the same connectivity requirement.

---

## 7. What Task 10 changed

| File | Change |
| --- | --- |
| `apps/web/app/itg2.css` | One new class, `.itg2-skeleton` (glass placeholder surface), +1,214 bytes (71,484 → 72,698) |
| `apps/web/components/ui/skeleton.tsx` | `PageSkeleton` card/panel blocks carry `.itg2-skeleton`; `rounded-xl` dropped (the class supplies the 24px v2 radius); comment updated. Geometry unchanged |
| `apps/web/app/not-found.tsx` | Glass panel (`.itg2-card.itg2-card-flat`), `.itg2-eyebrow` kicker, `.itg2-btn-primary` link. Copy and href identical |
| `apps/web/app/error.tsx` | Same glass panel + `.itg2-btn-primary` retry. Copy, digest rendering and `reset` wiring identical |
| `apps/web/app/global-error.tsx` | Inline palette literals aligned to v2 (`#04060C` / `#F4F8FF` / `#1268D8`) + comment updated. Structure, copy and behaviour identical |

Not changed, deliberately: `components/auth/action-form.tsx` (shared
by design), all six `loading.tsx` wrappers (already uniform), every
empty state (already v2), all of `lib/`, and the feedback interaction
model (§4).

## 8. Rules for future work

- New route that needs a loading state: add a `loading.tsx` that
  renders `PageSkeleton` — nothing bespoke.
- New empty state: honest sentence on a v2 card, next action named.
  Never render placeholder rows or zeros as data.
- New success feedback: prefer the shared ActionForm boxes inside
  forms; page-level confirmations use `.itg2-notice-*`; do not
  introduce a fifth pattern (or a toast system) without a product
  decision.
- New destructive action: state what is preserved or that it is
  permanent, use `.itg2-btn-danger`, and pick the dialog (consequential,
  needs context) or the two-step arm (inline, low ceremony) pattern.
  Financial records are never hard-deleted.
- Errors shown to traders never include stack traces; the digest is
  the support reference.
