# ITG TraderOS — Mobile (React Native + Expo)

The mobile shell for ITG TraderOS, built in **Phase 21 M2**. It is
**read-oriented**: secure sign-in, a biometric unlock gate, and
read-only screens over the trader's **real** data. There are **no
financial write workflows** in M2 (no trade creation/editing) and
**no fake or demo data anywhere** — every screen renders real
authenticated data or an honest empty state.

Stack: Expo SDK 58 · React Native 0.88 · React 19 · TypeScript ·
expo-router · @supabase/supabase-js · expo-secure-store ·
expo-local-authentication.

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
- **Everything else is a direct Supabase read under RLS** with
  the signed-in client: `trades`, `psychology_records`,
  `lessons`, `trade_screenshots` (count only in M2),
  `strategies`/`setups` (names), `goals`, `goal_progress`,
  `profiles`, `user_levels` (+ `levels` name), `xp_transactions`,
  `notifications` (unread count), `ai_insights`.
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

## Screens (all read-only, real data)

| Route | Data |
| --- | --- |
| `(auth)/login` | Supabase password sign-in → session bootstrap → biometric prompt |
| `lock` | Biometric unlock gate |
| `(app)` Dashboard | Week summary (API) + stored level/XP + unread notifications |
| `(app)/trades` | Own trades list (RLS, newest first, cap 100) |
| `(app)/trade/[id]` | Trade detail: stored fields/metrics, psychology, lessons |
| `(app)/analytics` | Week/month summary: win rate, profit factor, avg R, strategy/session breakdowns, best/worst |
| `(app)/goals` | Goals + latest recorded progress (honest "no recorded progress" state) |
| `(app)/coach` | Latest stored `ai_insights` cards + note that the Interactive AI Coach arrives next phase — no chat UI, no generated replies |
| `(app)/profile` | Own profile row, avatar, level, sign out |

## What M2 deliberately excludes

- Any write workflow (add/edit/review/correct trades, goals,
  risk, uploads) — the endpoints exist (M1/M2 backend) but the
  shell does not call them yet; that is M3 in the spec's
  phasing.
- Interactive AI Coach / chat (next major phase).
- Offline drafts and push notifications (M4).
- EAS builds and store submission (M5).

## Verification performed (sandbox)

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
