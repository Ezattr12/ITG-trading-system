# Task 12 — Mobile M2 Finalization (agent-side)

Status: agent-side work COMPLETE. M2 itself remains OPEN — its final gate is
Ezat's physical-device verification report on the fresh APK build. No agent
can supply that gate, and M2 must never be declared complete without it.

Zero code changes were required. The finalization audit found the mobile app
already consistent with the design system and the current backend contracts.

## Consistency audit (apps/mobile)

- Violet confinement verified: token-level violet (`tokens.violet`,
  `violetLight`, `auroraViolet`, `auroraPurple`) appears only in the Coach
  screen, the dock's Coach active state (`app/(app)/_layout.tsx`, in-code
  comment states the rule), and one design-approved atmosphere glow in
  `src/components.tsx`. The single violet rgba literal is inside the Coach
  screen.
- Every other hardcoded colour resolves to the palette or is
  documented-intentional: light-pink tint of the loss colour on the Delete
  button (readability), `GOLD_BRIGHT #E9C37C` and its tints (level /
  achievement gold only), white glyphs on gradients, black shadow colours,
  GradientCard stops are the mandated blues.
- Dock geometry as built: 54×54 blue→cyan Add circle, centre ≈10px above the
  dock top edge, glass dock 64px / 28px radius, tabs
  [Home, Trades, Stats] Add [Goals, Coach, Profile].

## Notifications copy — verified

The empty state reads "Goal, level and achievement notifications will appear
here." The Task 9 audit confirmed goal/level/achievement producers exist and
no coach notification kind exists, so the earlier salvaged edit removed
exactly the false "coach notifications" promise. The screen reads the
`notifications` table through the RLS-scoped client, marks read via
`POST /api/mobile/notifications/read`, and re-reads after every change (no
optimistic state).

## Endpoint contract check — 21/21 unchanged

Every endpoint in `apps/mobile/src/api.ts` maps 1:1 to a live handler in
`apps/web/lib/api/handlers/` with the same request/response shape. Tasks 2–10
were presentation-only on web and the performance pass changed web query
internals/caching, not handler schemas; each handler still runs the same
envelope validation (identity fields / unknown keys → 400 naming the field,
byte-identical 404 for missing vs not-owned, one `api.mobile.*` audit row per
call). Spot-verified in source: `handleEditTrade` still requires the
`{correction, review}` envelope and returns
`{trade_id, reversed_trade_id, changed_fields, financial_changed, journal_changed}`
at 201/200 exactly as the app expects.

Direct table reads (RLS-scoped client) are unaffected: no migrations since
the Delete build, and the app uses `select("*")` or its own column lists, so
web-side column trims do not touch it. Screenshots use signed URLs (3600s)
from the private `trade-screenshots` bucket.

## Dead/broken surface sweep — clean

Zero TODO/FIXME/lorem/mock/fake/dummy/sample hits across `app/` + `src/`
(only legitimate input `placeholder` props). All 7 dock tabs resolve to
existing screens; every `router.push/replace` target resolves to an existing
route file; the TypeScript check passing confirms no reference to a removed
function survives.

## Mobile gate

- `npx tsc --noEmit` in apps/mobile: clean.
- `npx expo export --platform android`: exit 0, Hermes bundle produced;
  `apps/mobile/dist` removed afterwards.

## Which APK Ezat should test

The Delete-era build (GitHub Actions run 41326396226, commit 2460f370)
predates the notifications copy fix. A fresh build from current HEAD
(574be13b, the PERF commit — the mobile tree's only change since 2460f370 is
that copy fix) is the correct M2 test target. It is dispatched via
`workflow_dispatch` on `.github/workflows/mobile-apk.yml`.

## Device checklist (Ezat)

- Profile: loads with photo; edit + save persists after reload and after
  logout/login; completion % updates; Verified badge appears exactly at 100%
  and disappears below it; level/XP correct; glass dock + Add button.
- Trades: add a trade; attach a screenshot; open detail; edit (financial and
  journal-only); delete (open and closed).
- Coach: ask a question; FACT/INFERENCE/RECOMMENDATION render; violet only
  on this surface.
- Visual: black/depth, deep-blue layers, white text, green/red semantics,
  glass depth, no clipping/overflow.
- Session: login; session persists across app restarts; biometric gate
  prompts and its fallback works; logout returns to login.

Remaining gate for M2: Ezat's on-device report on the fresh build.
