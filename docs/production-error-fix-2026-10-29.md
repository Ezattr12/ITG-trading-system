# Production error fix — 2026-10-29 (Digest 2190686083)

## Symptom

On the live Phase 19 build, the Dashboard loaded for the owner,
but another signed-in page showed the generic production error:

> Application error: a server-side exception has occurred while
> loading itg-traderos.vercel.app. Digest: 2190686083

Unauthenticated routes were verified healthy (all 200 / 307).
Vercel's runtime-log API returned 403 for this project's team
scope via the connector, so the exception was identified by
local reproduction against the live Supabase project instead:
a production build (`next build` + `next start`) connected to
live Supabase, signed in with the Phase 14 verification test
account brought to the owner's exact data state (profile row
present, onboarding complete, zero trades/goals/XP/plans/
notifications/insights/reviews/certificates). Every app route
was swept; **/profile was the unique failing route** (HTTP 500,
same full-page "Application error / server-side exception"),
and Dashboard loaded fine in the same session — matching the
owner's report exactly. (Digests are build-specific hashes;
the local build's digest for this error differs numerically
from the Vercel build's 2190686083. Route, error class,
message and data-state match are unambiguous.)

## Root cause

`apps/web/app/profile/page.tsx` (Phase 19) rendered:

```tsx
<AnimatedNumber value={xpTotal} format={(n) => `${Math.round(n)} XP`} />
```

`app/profile/page.tsx` is a **Server Component**;
`AnimatedNumber` (`components/analytics/count-up.tsx`) is a
**Client Component** (`"use client"`). Passing an inline
function as a prop across the server→client boundary is not
serializable, and Next.js throws during RSC rendering:

```
Error: Functions cannot be passed directly to Client Components
unless you explicitly expose it by marking it with "use server".
{value: 0, format: function format}
```

The usage was unconditional in the profile hero, so /profile
failed for **every** signed-in user in the Phase 19 build,
regardless of data. Every other page avoided this by using the
client-side wrappers defined inside `count-up.tsx` itself
(`CountUpMoney`, `CountUpPct`, `CountUpDecimal`), which create
their format functions inside the client component.

### Latent identical bug

`apps/web/app/levels/page.tsx` had the exact same pattern. It
did not fail in the sweep only because it renders inside the
`score !== null` branch: a zero-data user takes the "No level
yet" branch and never renders it. For any user **with** a level
score, /levels would have thrown the identical exception.

## Fix

No visual/design change; the rendered output is identical
(same count-up animation, same "N XP" formatting).

- `components/analytics/count-up.tsx`: added a `CountUpXp`
  client wrapper in the existing wrapper pattern — the format
  function is created inside the client component.
- `app/profile/page.tsx`: `<CountUpXp value={xpTotal} />`.
- `app/levels/page.tsx`: `<CountUpXp value={bundle.xpTotal} />`.
- `apps/web/lib/motion/rsc-boundary.test.ts`: new regression
  guard — fails if any server route file passes a `format`
  function to `AnimatedNumber` or imports it directly.

## Secondary bug found during the same sweep (PDF routes)

Generating a report PDF failed with
`ENOENT: .../chunks/data/Helvetica.afm` — pdfkit reads its font
metrics from its own package directory at runtime, and the
bundled server output did not include them. This did **not**
produce the full-page error (the /reports page itself is 200),
but PDF generation (reports and certificates share pdfkit) was
broken in this build configuration.

Fix: `next.config.ts` now sets
`serverExternalPackages: ["pdfkit"]`, so Node resolves pdfkit
from `node_modules` at runtime, data files included.

## Verification

- Vitest: 351/351 (349 before + 2 new regression-guard tests).
- Typecheck, lint, `scripts/security-check.mjs`: pass.
- Production build: pass (30 routes, first-load JS unchanged
  at 103 kB).
- Playwright: 36/36 (fresh server).
- Authenticated route sweep against live Supabase (local
  production build, owner's data state): /profile and all
  other routes re-checked after the fix; reports PDF route
  re-checked for a real `%PDF` response.
- Deployed to Vercel production and the affected route
  verified live (see the deployment record in the fix report /
  MEMORY.md).
