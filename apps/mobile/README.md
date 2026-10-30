# ITG TraderOS — Mobile (React Native + Expo)

The mobile app for ITG TraderOS. The shell was built in **Phase 21
M2** (secure sign-in, a biometric unlock gate, read-only screens);
**Phase 25 activated the write workflows** — trades (add / close /
correct / cancel), trade reviews, screenshots, goals, risk rules &
trading plan, weekly review, backtesting and notifications — all
through the `/api/mobile/*` endpoints from Phases 21 M1/M2, all over
the trader's **real** data. There is **no fake or demo data
anywhere** — every screen renders real authenticated data or an
honest empty state, and every number shown is a stored value or a
server-computed aggregate (never calculated in the app).

Stack: Expo SDK 58 · React Native 0.88 · React 19 · TypeScript ·
expo-router · @supabase/supabase-js · expo-secure-store ·
expo-local-authentication · expo-image-picker (Phase 25, for
screenshot attachment — the only dependency Phase 25 added).

## Setup

```bash
cd apps/mobile
cp .env.example .env   # fill in the real anon key
npm install --workspaces=false
```

> **Standalone install (important):** this package deliberately
> installs OUTSIDE the root npm-workspaces graph. The repo root
> declares `workspaces: ["apps/*"]`, and joining that graph would
> hoist the entire Expo/React Native toolchain into the web app's
> install and rewrite the root lockfile. `--workspaces=false`
> keeps mobile fully self-contained (own `node_modules`, own
> lockfile) and provably leaves the web build/test suite
> untouched — root `npm test` passes with this app present, and
> the root Vitest include globs never scan `apps/mobile`.

### Environment variables

`EXPO_PUBLIC_*` values are inlined into the bundle at build time.

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (defaults to the ITG project URL in code). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon (public)** key. Required for sign-in. Never a service-role key — RLS protects the data. |
| `EXPO_PUBLIC_API_BASE_URL` | Base URL for the `/api/mobile/*` endpoints (defaults to `https://itg-traderos.vercel.app`). |

`.env` is gitignored; `.env.example` documents the shape with
placeholder values only.

## Running

- **Expo Go / dev server:** `npm start`, then scan the QR code
  with Expo Go (SDK 58) or press `a`/`i` for an emulator.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`, clean).
- **Bundle gate:** `npm run export` (`expo export --platform android`,
  verified in CI/sandbox — produces a Hermes bundle).
- **EAS Build / store submission:** intentionally NOT set up in
  M2 (no EAS project, no credentials). That is a later phase.

## How it talks to the backend

- **Auth:** Supabase email/password (`signInWithPassword`)
  against the same project as the web app.
- **First call after sign-in:** `POST /api/mobile/session`
  (Bearer access token) — the idempotent profile bootstrap that
  creates the caller's `profiles` row via the web's own
  profile-creation path when missing, and reports
  `onboarding_complete`. This closes the profile-less gap a
  mobile-first signup would otherwise hit.
- **Aggregates:** `GET /api/mobile/summary?range=week|month` —
  the web report engine's `ReportSummary`, computed server-side.
- **Writes (Phase 25)** go through `src/api.ts`, one helper per
  endpoint: trades (create / correct / cancel), trade review,
  screenshot upload (multipart, field `file`) + delete, goals
  (create / progress / status), risk rules + trading plan (PUT),
  weekly review, backtesting, notification mark-read. Bodies are
  exactly the web schema fields (camelCase) — **never an
  identity field**: identity comes from the Bearer token, and
  the API rejects `user_id`/`profile_id`/`userId` bodies with a
  400. Server error messages are thrown verbatim and shown
  unchanged in the forms. The full screen → endpoint → fields →
  response contract table is in `docs/phase-25.md` §2.
- **Everything else is a direct Supabase read under RLS** with
  the signed-in client: `trades`, `psychology_records`,
  `lessons`, `trade_screenshots` (full rows; images displayed
  via `createSignedUrl(path, 3600)` from the user's client —
  the same mechanism as the web trade page; the bucket stays
  private), `strategies`/`setups` (names + form pickers),
  `goals`, `goal_progress`, `risk_rules`, `trading_plans`,
  `weekly_reviews`, `daily_activity` (backtesting pre-fill),
  `profiles`, `user_levels` (+ `levels` name), `xp_transactions`,
  `notifications`, `ai_insights`.
- **No client-side financial calculations.** P&L, ROI, R
  multiples, win rates and profit factors are all stored values
  or server-computed aggregates. `@itg/calc` is therefore NOT
  consumed in M2 — deliberately: there is nothing for it to
  calculate in a read-only shell, and keeping it out avoids
  Metro monorepo plumbing for zero benefit. It can be linked
  in a later phase if a screen ever needs client-side math.
- **Fonts:** system font in M2 (no `expo-font`/Inter yet) to
  keep the bundle lean; the visual identity is carried by the
  ITG color/glass token system in `src/theme.ts`, which mirrors
  the web app's `--itg-*` tokens (glass 0.075/0.12/0.16, text
  `#f8f7ff`/`#d4d5e8`/`#8589a6`, profit `#21f3a5`, loss
  `#ff4d72`, gold `#bd935f` for level/premium status only).

## Session storage & the biometric gate

- supabase-js persists the session through a **chunked
  SecureStore adapter** (`src/supabase.ts`): SecureStore values
  are limited to ~2048 bytes and a Supabase session JSON is
  larger, so the value is split into 1800-char slices under
  `<key>.chunk.<n>` with a count under `<key>.chunks`. Writes
  clear stale slices first; reads reassemble. Tokens never
  touch AsyncStorage or plain files.
- **Biometric gate** (`src/auth.tsx`): after the first sign-in,
  if the device has enrolled biometrics the user is asked once
  whether to enable unlock with Face ID / fingerprint (choice
  stored in SecureStore). When enabled, a cold start with a
  restored session opens on the lock screen and requires
  `LocalAuthentication.authenticateAsync` before any app screen
  is shown. "Use password instead" signs out to the login
  screen. Devices without biometrics skip the gate entirely
  and fall back to the session.

## Screens

| Route | Data / actions |
| --- | --- |
| `(auth)/login` | Supabase password sign-in → session bootstrap → biometric prompt |
| `lock` | Biometric unlock gate |
| `(app)` Dashboard | Week summary (API) + stored level/XP + notifications link with live unread count |
| `(app)/trades` | Own trades list (RLS, newest first, cap 100) + **Add trade** |
| `(app)/trade/new` | **Add Trade** form (quick-trade fields; server computes P&L/R/ROI) |
| `(app)/trade/[id]` | Trade detail: stored fields/metrics, psychology, lessons, **actions (Review / Close / Correct / Cancel)** and the **screenshots manager** (signed-URL display, add via photo library, remove) |
| `(app)/trade/[id]/close` | **Close trade** for an open trade (see the note below) |
| `(app)/trade/[id]/correct` | **Correct trade** — full-form; saving creates a reversal, never overwrites |
| `(app)/trade/[id]/review` | **Review** — journal + psychology full-form save (see the ⚠ warning below) |
| `(app)/analytics` | Week/month summary: win rate, profit factor, avg R, strategy/session breakdowns, best/worst |
| `(app)/goals` | Goals + latest recorded progress + **New goal** |
| `(app)/goal/new` | **Create goal** |
| `(app)/goal/[id]` | Goal detail: **record progress**, **change status**, progress history |
| `(app)/risk` | **Risk rules editor** + **trading plan editor** (full-form PUT saves, pre-filled from RLS) |
| `(app)/coach` | Latest stored `ai_insights` cards + **weekly review form** + **backtesting log** (XP figures are the endpoints' responses) |
| `(app)/notifications` | Notification list with unread state; tap to mark one read, or mark all read |
| `(app)/profile` | Own profile row, avatar, level, links to Risk & plan / Notifications, sign out |

> **Why "Close trade" creates a reversal:** TraderOS never updates
> a trade's financial fields in place — the web app closes an open
> trade the same way. Closing submits the trade's values plus the
> exit price/time to the correct endpoint: the core creates the
> closed trade and marks the original open trade `reversed`, audit
> trail intact. The close screen explains this before submitting.

> ⚠ **Review round-trip warning (Phase 24 finding):** the review
> save is a FULL-FORM save — it overwrites the trade's strategy,
> setup, market condition, reason, session and notes, and the
> psychology record, with exactly what is sent. The review screen
> therefore pre-fills **every** field from the current trade +
> psychology reads and always sends the complete payload:
> `strategyId` round-trips the trade's current strategy and
> `setupName` round-trips the current setup's name (the core
> resolves the name back to the setup row). Sending
> `strategyId: null` unintentionally **clears** the trade's
> strategy — this already happened once during Phase 23
> verification. Never build a review payload from partial state.

## What is still excluded / known gaps

- **Standalone discipline-event logging** — no endpoint exists
  (`logDisciplineEvent` is an internal engine with no API
  surface). Discipline is covered via the review's discipline
  rating, goals, and the summary's discipline %. See
  `docs/phase-25.md` §3.
- **Editing a goal's title/target/dates** — the API's goal PATCH
  accepts `{ status }` only; the goal screen offers status
  changes and says so plainly.
- **Profile editing / avatar upload from the app** — endpoints
  exist (M1) but were outside Phase 25's workflow list.
- Interactive AI Coach / chat (Phase 26).
- Offline drafts and push notifications (M4 in the spec).
- EAS builds and store submission (M5 in the spec).

## Verification performed (sandbox)

M2 (2026-10-30):

- `npm install --workspaces=false` — standalone install OK;
  root `package.json`/`package-lock.json` byte-identical after.
- `npx tsc --noEmit` — clean.
- `npx expo export --platform android` — succeeded (Hermes
  bundle ~3.2 MB).
- Root `npm test` with this app present — 574/574 passing
  (Vitest globs do not include `apps/mobile`).
- Not verified here: running on a physical device / emulator
  (no device in the sandbox) — first device run is via Expo Go
  with a real `.env`.

Phase 25 (2026-10-30):

- `expo-image-picker` installed via `npm install
  --workspaces=false` (SDK 58 line, `~58.0.10`, plus its
  `expo-image-loader` dependency) — the only new dependency.
- `npx tsc --noEmit` — clean.
- `npx expo export --platform android` — succeeded.
- Root `npm test` — 704/704 passing, unchanged (no web file
  touched; the root suite baseline was 704 before Phase 25).
- Payload audit — every request body diffed against the
  handler allow-lists (`apps/web/lib/api/handlers/*.ts`); see
  `docs/phase-25.md` §2.
