# Phase 2 — Authentication & Onboarding

Status: implemented locally, tested. **Supabase is not connected yet** —
auth/onboarding code is real and complete, but it cannot log anyone in
until a Supabase project exists and its URL/keys are set. The UI says
so clearly and disables submit until then. No demo login, no fake session.

## Spec covered
- §6 Auth: sign up, login, logout, forgot/reset password, session
  persistence (cookie-based, @supabase/ssr), email verification
  handling via `/auth/callback`, profile creation on first login.
  OAuth-ready: the callback route already exchanges any provider's
  code; no provider is configured in v1.
- §7 Onboarding: 5 short steps — personal info, trading background,
  historical performance, current work, trading capital. Every field
  a trader may not have can be "Not provided" / left blank; missing
  data is displayed as "Not Provided", never invented (spec §40).
  Sensitive fields (monthly income, trading capital) are private
  to the owner (RLS, Phase 1 migrations).
- §29 Profile: view/edit personal + trading info, photo upload,
  level / achievements / certificates as honest empty states
  (Phases 7–8 fill them).
- §37 Login page: premium dark, lightweight CSS-only backdrop, fast,
  password visibility toggle.

## Routes
| Route | Purpose |
|---|---|
| `/` | Landing; signed-in users redirect to `/dashboard` |
| `/login`, `/register` | Email + password, Zod-validated Server Actions |
| `/forgot-password`, `/reset-password` | Reset flow; same message whether or not the email exists |
| `/auth/callback` | Email verification / reset code exchange |
| `/onboarding` | 5-step wizard, saves each step independently |
| `/dashboard` | Protected; honest empty state until Phases 3–4 |
| `/profile` | Edit profile, upload photo, view level/achievements/certificates |

## Protection
- `apps/web/middleware.ts`: refreshes the Supabase session on every
  request; unauthenticated users are redirected to `/login` from
  protected routes; authenticated users are redirected away from
  `/login` / `/register`.
- `lib/auth/session.ts`: `getCurrentUser()` returns the user + profile
  + onboarding, or null. Creates the profile row on first login if
  signup could not (email confirmation required) — Phase 1 has no
  `auth.users` trigger, so this is the profile-creation path.

## Validation, security
- Zod on every Server Action boundary (`lib/auth/validation.ts`).
- Passwords: min 8 chars, upper + lower + number.
- Rate limiting: in-memory sliding window, 5 login/signup attempts
  per 15 min per email, 3 reset requests per hour (`lib/auth/rate-limit.ts`).
  Single-instance guard; Phase 11 replaces it with a shared store.
- Audit: `auth.login`, `auth.signup`, `auth.logout`,
  `onboarding.step_saved`, `onboarding.completed`, `profile.updated`
  are written server-side via the service-role client when available;
  audit never breaks a login and never claims a write that did not happen.
- Avatar upload: Supabase Storage bucket `avatars`, images only,
  2 MB max, per-user path. Disabled with a clear error until Supabase
  is connected / the bucket exists. No fake photo.

## What is NOT in Phase 2
- No live Supabase project, no Vercel deployment (Phase 13).
- No trade entry (Phase 3), no dashboard analytics (Phase 4).
- No MFA yet (architecture is MFA-ready via Supabase Auth; Phase 11).
- No OAuth provider configured.

## Tests
Vitest: `lib/auth/validation.test.ts`, `lib/onboarding/completion.test.ts`,
`lib/auth/rate-limit.test.ts` — plus the Phase 1 calc tests (24).
Mocks are used only inside tests, at the client boundary; production
code never mocks Supabase.

## Phase 3 needs next
- Trade entry (quick + advanced), using the same Server Action +
  Zod + RLS pattern, and the `trades` / `trade_screenshots` /
  `psychology_records` / `lessons` tables from Phase 1.
- The dashboard's trade count / XP queries already read those tables;
  Phase 3 makes them non-empty for real traders.
