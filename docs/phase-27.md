# Phase 27 — Institutional Production Hardening

**Date:** 2026-10-30. **Scope:** local audit + safe fixes + docs.
Nothing deployed, nothing committed, **no SQL run against
production** — migrations are treated as the database truth and
live-database checks are flagged for the parent gate (§12).
Every finding is classified **FIXED** (safe, tested fix applied),
**MIGRATION** (additive migration written for the parent to
apply), or **RECOMMENDATION** (exact change drafted, decision
deferred). No MIGRATION-class findings arose: the schema's RLS
and index coverage left nothing additive to write (§5, §6).

**Test evidence (final):** Vitest **732/732** (baseline 724 +
8 new: CSP object-src, 4 `safeNextPath`, 3 certificate-action;
5 further audit assertions extend existing tests), typecheck
clean (web + calc), lint clean, production build clean,
`security:check` passed (373 files), Playwright (CI=true)
**36/36** including the extended header test. Baselines were
724 Vitest / 36 Playwright.

---

## 1. Security headers

**Current state (evidence).** `next.config.ts` applies
`securityHeaders()` (`apps/web/lib/security/headers.ts`) to
`/:path*` — every route, API included. Six headers ship today:
HSTS `max-age=63072000; includeSubDomains; preload`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`,
and a Content-Security-Policy. There is no `vercel.json`; the
Next config is the single header source. The e2e smoke test
asserts the set against a real production-build response.

The CSP already exists (Phase 11) and is sensibly scoped:
`default-src 'self'`, `connect-src` limited to self +
`*.supabase.co` (REST + Realtime wss), `frame-ancestors
'none'`, `form-action 'self'`, `base-uri 'self'`, fonts
self-only (Inter is self-hosted by `next/font` at build time,
`app/layout.tsx`). Two deliberate loosenesses: `script-src` /
`style-src` keep `'unsafe-inline'` (Next hydration + runtime
styles; the file header documents a nonce-based CSP as future
work), and `img-src` allows `https:` from any origin.

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 1.1 | No `object-src` directive — plugin content fell back to `default-src 'self'` | Low | **FIXED** |
| 1.2 | `script-src 'unsafe-inline'` — CSP cannot stop injected inline scripts | Medium | RECOMMENDATION |
| 1.3 | `img-src … https:` — images loadable from any HTTPS origin | Low | RECOMMENDATION |

**Fix 1.1.** Added `object-src 'none'`. Proof it cannot break
anything: a source scan finds zero `<object>`, `<embed>`,
`<applet>` or `dangerouslySetInnerHTML` in `app/`,
`components/`, `lib/`; the extended unit test
(`lib/security/headers.test.ts`) pins the directive, and the
extended Playwright header test asserts it on the real
response while the whole suite exercises the app under the
new policy.

**Recommendation 1.2 (nonce CSP, drafted).** Move header
generation into `middleware.ts`: generate a per-request nonce
(`crypto.randomUUID()`), set `script-src 'self'
'nonce-<value>' 'strict-dynamic'`, pass the nonce via a
request header so Next applies it to its inline scripts, and
keep the static headers in `next.config.ts`. This is the
documented Phase 11 follow-up; it is a behaviour-changing
project (every page becomes dynamic) and must land with its
own phase + full Playwright + a production canary, not inside
a hardening sweep.

**Recommendation 1.3.** Tighten to
`img-src 'self' data: blob: https://*.supabase.co` — the only
remote images the app renders are Supabase Storage URLs
(avatars via `getPublicUrl`, screenshots via signed URLs).
Kept as a recommendation because a single missed external
image source would break trader content silently; verify
against production traffic logs first.

## 2. Rate-limit coverage map

Limiter machinery: `lib/auth/rate-limit.ts` — in-memory
sliding window, per instance (documented limitation;
`docs/security.md` residual risk #2; call sites isolated so a
shared store such as Upstash can replace the backing Map
without touching callers). Supabase Auth platform limits sit
behind the app-level auth limits.

| Surface | Guard | Limit |
| --- | --- | --- |
| Web login / signup (`lib/auth/actions.ts`) | `AUTH_RATE_LIMIT`, keyed by email | 5 / 15 min |
| Web password-reset request | `RESET_RATE_LIMIT`, by email | 3 / hour |
| Admin actions (all 7) | `ADMIN_RATE_LIMIT`, per admin per action | 20 / min |
| Trade create (web + mobile, shared core) | `TRADE_RATE_LIMIT` in `createTradeCore` | 30 / 10 min |
| Screenshot + avatar upload (shared cores) | `UPLOAD_RATE_LIMIT` | 10 / 10 min |
| Every `/api/mobile/*` handler | API pipeline `checkApiRateLimit`, per user per operation | 60 / min |
| `POST /api/coach/chat` + `/api/mobile/coach/chat` | shared bucket `coach-chat:<userId>` | 20 / min |
| `POST /api/internal/coach-insights` | `coach-insights:<userId>` | 30 / min |
| All other web mutations (review save, correct, cancel, goals, risk saves, weekly review, backtesting, onboarding, profile update, notification marks, certificate issue, risk-event resolve) | **none in-app** | — |

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 2.1 | Unguarded authenticated web mutations (last table row). All require a valid session, are owner-scoped by RLS, and are individually low-throughput form posts; the genuinely abusable writes (trade create, uploads, auth, admin, coach) are all limited. Adding per-action limits to ~15 more actions is a behaviour change with false-positive risk for legitimate bulk journaling. | Low | RECOMMENDATION |
| 2.2 | Limiter is per-instance in-memory: on multi-instance Vercel a flood is only blunted, not stopped (already documented as accepted residual risk). | Medium | RECOMMENDATION |
| 2.3 | `AUTH_RATE_LIMIT` docstring claimed "per email + IP bucket"; call sites key on email only. | Info | **FIXED** (comment corrected) |

**Recommendation 2.1.** If abuse or accidental loops are ever
observed, add one shared preset (e.g. 120 writes / 10 min per
user) inside the service cores for the remaining mutations —
cores, not actions, so web + mobile inherit it together.
**Recommendation 2.2.** Move the `buckets` Map in
`lib/auth/rate-limit.ts` behind the existing
`checkRateLimit` signature to a shared store (Upstash Redis
`@upstash/ratelimit` or a Postgres table) when traffic
justifies a second vendor; no call-site changes needed.

## 3. Error handling

**Current state.** API 500s are uniformly sanitised: every
mobile/coach handler catches core throws and returns
`apiError(500, "internal")` with no message
(`lib/api/handlers/*.ts`, `lib/coach/chat-handler.ts:228`).
No raw PostgREST/DB error reaches a client — a scan of all
`*.message` flows shows only Zod first-error messages
(`firstZodError`) and curated strings; the one
`error.message` inspection (certificate duplicate-key branch,
`lib/certificates/actions.ts`) branches internally and
returns a curated message. Server-action failures return
`{ ok: false, error }` shapes throughout. PDF routes return
curated errors. `loading.tsx` exists for the six heaviest
routes.

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 3.1 | **No `error.tsx`, `global-error.tsx`, or `not-found.tsx` anywhere in `app/`** — unhandled render errors and signed-in 404s fell back to the framework's unbranded default pages (production shows a bare digest page; the trader leaves the product context). One action path can reach it: `refreshCoachAnalysisAction` rethrows non-store errors. | Medium | **FIXED** |

**Fix 3.1.** Added `app/not-found.tsx` (branded 404 with a
dashboard link — signed-in users only; middleware still
sends signed-out visitors to /login, behaviour asserted by
the existing e2e test), `app/error.tsx` (client boundary:
plain-language message, framework digest shown as a support
reference — a correlation id, never a stack — and a `reset`
retry), and `app/global-error.tsx` (self-contained
`<html>/<body>` with inline styles in the app palette, since
a root-layout failure cannot rely on `globals.css` or the
self-hosted font). Build output now includes `/_not-found`;
the full Playwright suite passes against the production
build. Honest limit: the boundaries were not fault-injected
end-to-end (that would need a deliberately throwing route in
production code); they follow the framework contract exactly
and are covered by build + typecheck.

## 4. Session & auth security

**Current state.** `@supabase/ssr` throughout: browser client
(cookie session), server client (async `cookies()`, `setAll`
swallowing the Server-Component read-only case), middleware
`updateSession` refreshes on every non-API request
(`lib/supabase/{client,server,middleware}.ts`). Cookie flags
come from `@supabase/ssr` defaults (httpOnly, sameSite=lax,
secure in production). Middleware bypasses `/api/*`, whose
routes authenticate themselves (Bearer for mobile/internal,
session for coach chat). Mobile stores the session in
expo-secure-store (hardware-backed) via a chunking adapter
(`apps/mobile/src/supabase.ts`); only the anon key is present
client-side anywhere. Password policy (app layer):
≥ 8 chars + upper + lower + digit, max 128
(`lib/auth/validation.ts`). Reset: request action rate-limited
(§2), reset consumes the Supabase recovery session and returns
a generic failure message that cannot enumerate accounts.
Admin: **every** admin action calls `requireAdmin()` →
`adminGate(profile)` server-side before any write, is rate
limited, and fails closed when its audit row cannot be
written (`lib/admin/actions.ts`, `lib/admin/access.ts`).
Privilege columns are additionally trigger-guarded at the DB
layer (migration 0015).

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 4.1 | `POST /auth/callback` redirected to the unvalidated `next` query param: `` `${origin}${next}` `` with `next=@evil.com` parses with evil.com as host (origin becomes userinfo) — an open redirect after a genuine auth-code exchange. Exploitation needs a victim's own single-use code, so impact is bounded, but the pattern is wrong. The login page ignores `next` (always /dashboard); this route was the only consumer. | Medium | **FIXED** |
| 4.2 | Engine functions exported from `"use server"` modules trust a caller-supplied `userId` and write via the service role: `awardXp`, `logXpPenalty` (`lib/gamification/actions.ts`), `logRiskEvent` (`lib/risk/actions.ts`), and the delegating re-exports `logDisciplineEvent` / `createNotification` + `ensureDisciplineReminderLogged` (`lib/discipline/actions.ts`), plus `getAuthorisedFinancials(userId, adminId)` (`lib/admin/actions.ts`). In Next.js every export of a `"use server"` file is a registered Server Action. Today the exposure is latent: verified by scan, **no client component imports any of them** (only session-checked form actions are imported), so their action ids never ship to a browser, and page-route action posts still pass the auth middleware. If an id ever leaks, a signed-in trader could forge XP / notifications / risk events for arbitrary users. A session check inside the engines is NOT a safe fix: the mobile API path legitimately calls them with a Bearer identity and no cookie session (Phase 21). | Medium | RECOMMENDATION |
| 4.3 | Production Supabase Auth settings are dashboard-side; the repo's `supabase/config.toml` is a Phase 1 local scaffold (its own header says no remote project is linked) and records none of them. | Info | RECOMMENDATION |

**Fix 4.1.** New `lib/auth/redirect.ts`: `safeNextPath()`
accepts only a plain absolute path (single leading `/`, no
backslashes), everything else falls back to `/onboarding`.
4 unit tests pin the legitimate paths and the `@host`, `//host`,
`/\host` attack shapes. The callback route uses it.

**Recommendation 4.2 (drafted refactor, own phase).** Move the
engines into non-`"use server"` modules —
`lib/gamification/engine.ts` (awardXp, logXpPenalty,
checkAndAwardAchievements, ensureLevelStored,
refreshGamification), `lib/risk/engine.ts` (logRiskEvent) —
and delete the delegating re-exports in
`lib/discipline/actions.ts` (the engines already live in
`lib/discipline/service.ts`); update the ~import sites and
the `vi.mock` paths in the service tests to the new modules.
`"use server"` files then export only actions that derive the
user from the session. Full suite + Playwright must stay
green; do it as a dedicated change, not inside a hardening
sweep, because the mock-path churn touches most service tests.

**Recommendation 4.3 (verify in the Supabase dashboard; the
repo cannot evidence current values).** Access-token expiry
≤ 1 h; refresh-token rotation ON with reuse interval ≥ 10 s;
email confirmations ON; password minimums at least matching
the app schema (8 + upper/lower/digit) or enable leaked-
password protection; site URL + redirect allowlist limited
to the production domain and localhost. Record the verified
values in `docs/security.md` once checked.

## 5. RLS verification (from migrations)

**Current state — no gaps found.** Exactly **32 public
tables** are created across migrations 0001–0014; **all 32
have RLS enabled and at least one policy** (verified by
scripted parse of every migration, and already regression-
tested by `lib/security/rls-matrix.test.ts`, which also pins
the append-only set — audit_logs, xp_transactions,
risk_events, discipline_events, certificates, report_runs,
ai_insights, user_levels, user_achievements — to have **no**
client insert/update/delete policy). No policy uses
`using (true)` / `with check (true)`. The full role × table
matrix is documented in `docs/security.md`. Migration 0015
adds BEFORE INSERT/UPDATE triggers guarding `profiles.role`,
`profiles.verification_status`, and
`verification_records.status`, and pins `is_admin()`'s
`search_path`. Storage (migration 0016): `avatars` bucket
public-read / owner-write (profile photos are shown by
design; the app uses `getPublicUrl`), `trade-screenshots`
bucket **private**, owner-only select/insert/update/delete
keyed on the first path segment = `auth.uid()`; the app
serves screenshots through 1-hour signed URLs
(`app/trades/[id]/page.tsx:77`).

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 5.1 | None in the migration-defined schema. | — | — |
| 5.2 | Migration files are the design truth, not proof of the live project's state (policies could drift if a dashboard change was made outside migrations). | Info | Live-check for parent (§12) |

## 6. Database indexes

**Current state — no migration warranted.** 40 indexes exist
(39 `CREATE INDEX` + the 0013 unique idempotency index on
`ai_insights`). Every hot path named for this phase is
covered:

| Hot path | Index |
| --- | --- |
| trades by user + status / opened / pair | `trades_status_idx (user_id, status)`, `trades_user_opened_idx`, `trades_user_pair_idx` (0004) |
| xp_transactions by user, recent first | `xp_transactions_user_idx (user_id, created_at desc)` (0008) |
| audit_logs by user / entity | `audit_logs_user_idx (user_id, created_at desc)`, `audit_logs_entity_idx` (0010) |
| notifications unread by user | `notifications_unread_idx (user_id, is_read)` + `notifications_user_idx` (0010) |
| lessons by trade / user | `lessons_trade_idx`, `lessons_user_idx` (0004) |
| ai_insights by user + week | `ai_insights_user_idx (user_id, generated_at desc)` (0009) + unique `(user_id, insight_type, period_start, period_end, metrics_snapshot)` (0013) |

Query-side, every hot list is capped:
`TRADE_LIST_FETCH_LIMIT = 500` is applied in trades, reports,
intelligence, analytics and reviews queries
(`lib/trades/queries.ts:24`); no unbounded `.select()` on a
user table was found in a hot path, and related rows are
fetched with batched `.in(...)` queries keyed on the capped
trade list (no N+1 loops).

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 6.1 | Report/intelligence queries filter closed trades on `closed_at` ranges; the planner uses `(user_id, status)` + filter rather than a dedicated `(user_id, status, closed_at)` index. Per-user trade volumes are inherently small (a single trader's journal), so this is not a proven hot path today. | Low | RECOMMENDATION |

**Recommendation 6.1.** If a single trader's closed-trade
count grows into the tens of thousands, add (drafted,
additive, parent applies):
`CREATE INDEX IF NOT EXISTS trades_user_status_closed_idx ON public.trades (user_id, status, closed_at DESC);`

## 7. Dependency review

**Method limitation (honest).** `npm audit` cannot run in
this sandbox: the managed registry proxy refuses the audit
endpoint — `npm warn audit 403 Forbidden … policy_denied`
(POST /-/npm/v1/security/audits/quick), at both the repo root
and `apps/mobile`. Severity counts therefore cannot be
produced locally in this phase. The control exists where it
can run: CI executes `npm audit --audit-level=high` on every
push/PR (`.github/workflows/ci.yml`, with a comment recording
exactly this sandbox limitation), alongside gitleaks.

**What was verified locally.** `npm outdated`: every
dependency is at its in-range latest ("Wanted" == "Current"
for all packages) — there are **no pending patch/minor
updates to apply**. Everything newer is a semver-major
upgrade, out of scope for this phase by rule:

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 7.1 | Major upgrades pending: next 15.5 → 16, zod 3 → 4, tailwindcss 3 → 4, vitest 2 → 5, eslint 9 → 10, recharts 2 → 3, typescript 5.9 → 7, @supabase/ssr 0.5 → 0.12 (0.x breaking), lucide-react 0.454 → 1.x, pdfkit 0.17 → 0.20, tailwind-merge 2 → 3, @types/node 22 → 26. | Info | RECOMMENDATION |

**Recommendation 7.1.** Schedule framework majors as their
own phase (Next 16 first, with zod 4 — both touch every
validation module and the action contracts). Until then the
in-range position is fully current, and CI's audit gate
fails the build on any high-severity advisory in the
meantime.

## 8. Performance review

**Current state (production build, this phase).** First Load
JS shared by all routes: **103 kB — exactly the stated
baseline, no regression** after Phases 22–26. Heaviest
routes are the chart pages: /dashboard 242 kB, /levels
242 kB, /analytics 241 kB, /progress 241 kB, /reports
241 kB (the recharts chunk, ≈ 139 kB over baseline);
everything else is ≤ 142 kB, API routes 103 kB. Middleware
94 kB. All data queries in hot paths are capped and batched
(§6). Images: avatars are plain stored files served from the
public bucket; screenshots are private + signed (1 h) and
capped at 5 MB by the upload core (avatar 2 MB) with
type/size validation in shared code
(`lib/profile/avatar-validation.ts`).

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 8.1 | Chart pages carry the full recharts bundle in First Load even where a chart is below the fold. | Low | RECOMMENDATION |

**Recommendation 8.1.** Lazy-load the chart components
(`next/dynamic`) on /dashboard, /analytics, /levels,
/progress, /reports in a UX phase and re-measure; expected
saving ≈ 100+ kB First Load on those routes. Not done here:
it changes loading behaviour on five verified pages, which
is precisely what a hardening phase must not do uninvited.

## 9. Environment configuration review

**Inventory (every `process.env` read in `apps/web`).**

| Variable | Required? | Absent in production ⇒ |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Placeholder URL; app runs in honest "not connected" mode (`lib/supabase/config.ts`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (server) | Service client is null: XP/audit/notification/certificate/admin writes fail closed or report failure — never silently "succeed" |
| `NEXT_PUBLIC_APP_URL` | Recommended | Falls back to `http://localhost:3000` — password-reset links would point at localhost. **Live-check for parent (§12): confirm it is set to the production origin in Vercel.** |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (one of) | Optional | Coach stays in deterministic mode by design (Phase 22); narration activates when a key is set |
| `COACH_LLM_MODEL` | Optional | Provider default model is used |

Mobile reads only `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`
(documented in `apps/mobile/.env.example`, which is accurate;
the code falls back to the production project URL/API when
unset — public identifiers, not secrets).

| # | Finding | Severity | Class |
| --- | --- | --- | --- |
| 9.1 | Root `.env.example` had drifted: it still carried the Phase 0 "Supabase and Vercel are NOT connected yet" note, omitted `ANTHROPIC_API_KEY` / `COACH_LLM_MODEL` (which the code reads), and listed `SENTRY_DSN`, which no code reads (no Sentry anywhere in the web app). `apps/web/.env.example` was accurate. | Low | **FIXED** |

**Fix 9.1.** Root `.env.example` rewritten to mirror
`apps/web/.env.example` (placeholders only — `security:check`
scans it and passes). No variable is read by the code that
is now undocumented in either file.

## 10. Monitoring readiness

**What exists today.** GitHub Actions CI on every push/PR:
lint, typecheck, unit tests, Playwright smoke, security
boundary checks, `npm audit --audit-level=high`, gitleaks
(`.github/workflows/ci.yml`). `audit_logs` is a complete
in-app trail (and, after §11, covers every user mutation).
Vercel provides deployment history + function logs per
deployment; Supabase provides database/Auth logs in its
dashboard. `scripts/security-check.mjs` guards the
service-role boundary + secret shapes in the working tree.

**Honest gaps — no error-tracking service is connected, no
uptime monitor, no alerting.** A production 500 today is
visible only if someone opens Vercel logs or a trader
reports it; the new `error.tsx` shows the trader a digest
that nobody is paged about.

| # | Recommendation | Unlocks |
| --- | --- | --- |
| 10.1 | Connect Sentry (`@sentry/nextjs`, DSN via Vercel env) — the root `.env.example` anticipated this for years | Error aggregation, release correlation by digest, alerting on new issues. Requires adding the SDK + `instrumentation.ts` and re-checking CSP (`connect-src` for the Sentry ingest host) |
| 10.2 | Uptime monitor on the production origin (e.g. Better Stack / UptimeRobot free tier) hitting `/login` every 5 min | Downtime detection independent of Vercel status |
| 10.3 | Vercel Web Analytics / Speed Insights (one-line enable in the dashboard / `@vercel/analytics`) | Real-user performance budgets to replace build-output estimates (§8) |
| 10.4 | Weekly review of Supabase dashboard logs + the admin audit page as a standing ops ritual; write the missing storage runbook (`docs/runbooks/` is an empty directory, yet migration 0016 references it for dashboard bucket creation) | Closes the human side of the loop |

Nothing was signed up for or purchased, per scope.

## 11. Audit-log review

**Coverage matrix (mutations → audit rows).** Domain rows are
written by the cores (web + mobile inherit them); the mobile
API layer additionally writes one `api.mobile.*` row per
call, and admin actions write fail-closed admin rows.

| Mutation | Audit before Phase 27 | After |
| --- | --- | --- |
| Login / signup / logout | `auth.login` / `auth.signup` / `auth.logout` | unchanged |
| Onboarding step / complete | `onboarding.step_saved` / `onboarding.completed` | unchanged |
| Profile update | `profile.updated` | unchanged |
| Avatar upload | XP-free by design; storage path is the record — no row (accepted) | unchanged |
| Trade create / review / correct / cancel | `trade.created` / `trade.review_saved` / `trade.corrected` / `trade.cancelled` | unchanged |
| Screenshot upload | `trade.screenshot_uploaded` | unchanged |
| **Screenshot delete** | **none (web path had no row at all)** | **`trade.screenshot_deleted` FIXED** |
| Goal create | `goal.created` | unchanged |
| **Goal progress** | **none** | **`goal.progress_recorded` FIXED** |
| **Goal status change** (completion awards +20 XP) | **none** | **`goal.status_changed` FIXED** |
| Risk rules / trading plan | `risk_rules.saved` / `trading_plan.saved` | unchanged |
| Risk event resolve | none — the `risk_events.resolved_at` column is the record (append-only table) | unchanged (accepted) |
| **Weekly review save** (+30 XP) | **none on the web path** | **`review.weekly_saved` FIXED** |
| **Backtesting log** (+15 XP/session) | **none on the web path** | **`backtesting.logged` FIXED** |
| **Certificate issue** | **none** (revoke was audited: `admin.certificate_revoke`) | **`certificate.issued` FIXED** |
| Notification mark read / mark all read | none | unchanged — RECOMMENDATION (below) |
| Coach insights compute (internal) | `internal.coach_insights_compute` | unchanged |
| Coach chat (web + mobile) | `coach.chat` (one row/call, both surfaces) | unchanged |
| Coach analysis refresh (web action) | none — the `ai_insights` rows it inserts are the record | unchanged (accepted) |
| Password reset (consume recovery link) | none — Supabase Auth's own log holds the event | RECOMMENDATION (below) |
| Admin: role / verification / cert revoke / achievement / level / setting / financial view | `admin.*` rows, fail-closed | unchanged |

All five FIXED rows are one `writeAuditLog` call in the
existing core/action pattern (`lib/auth/audit.ts` is
best-effort and fails silently, so an audit outage can never
break a save), each with tests:
`trade.screenshot_deleted` (lib/trades/service-m2.test.ts),
`goal.progress_recorded` + `goal.status_changed`
(lib/discipline/service.test.ts), `review.weekly_saved`
(lib/api/handlers/reviews.test.ts happy path),
`backtesting.logged` (lib/coach/backtesting.test.ts),
`certificate.issued` (new lib/certificates/actions.test.ts —
issue / ineligible / already-issued cases).

**Recommendation 11.a (notification read state).** Not
audited, deliberately left: read-state is high-churn,
zero-integrity-value data, the row's own state is the record,
and mobile calls already produce `api.mobile.*` rows. Audit
only if a compliance requirement appears.
**Recommendation 11.b (password reset).** Add an
`auth.password_reset` row in `resetPasswordAction` after a
successful `updateUser` (the user is available from the
recovery session). Drafted here rather than fixed because
`lib/auth/actions.ts` has no action-level test harness today
(only validation + rate-limit tests), and an untested change
to the credential path is exactly what this phase avoids.

## 12. Live-check items for the parent gate (not run here)

1. Production response headers on `https://itg-traderos.vercel.app/login`
   match §1 including the new `object-src 'none'` after deploy.
2. Live DB: `pg_policies` count per table == migrations;
   `relrowsecurity` true for all 32 tables; no policies
   beyond the migration set (drift check for §5.2).
3. Vercel env: `NEXT_PUBLIC_APP_URL` == production origin (§9).
4. Supabase dashboard Auth settings vs §4.3 list.
5. GitHub Actions: latest CI run green incl. `npm audit
   --audit-level=high` (§7).

## Fixes summary

| Fix | Files |
| --- | --- |
| CSP `object-src 'none'` | `lib/security/headers.ts`, `lib/security/headers.test.ts`, `e2e/smoke.spec.ts` |
| Error boundaries (404 / error / global-error) | `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx` (new) |
| Auth-callback open-redirect validation | `lib/auth/redirect.ts` (new), `lib/auth/redirect.test.ts` (new), `app/auth/callback/route.ts` |
| Audit rows ×5 | `lib/trades/service.ts`, `lib/discipline/service.ts`, `lib/reviews/service.ts`, `lib/coach/service.ts`, `lib/certificates/actions.ts` + tests in `lib/trades/service-m2.test.ts`, `lib/discipline/service.test.ts`, `lib/coach/backtesting.test.ts`, `lib/api/handlers/reviews.test.ts`, `lib/certificates/actions.test.ts` (new) |
| Rate-limit docstring accuracy | `lib/auth/rate-limit.ts` |
| Root env example drift | `.env.example` |

**No migrations written** — §5/§6 found no gap an additive
migration is needed for; the one drafted index (§6.1) is a
recommendation for a scale that does not exist yet.


## Production addendum (2026-10-30)

Deployed `dpl_F9GjGimc2hGR4zV2ogKb8keztcpy` READY (production). **No migration was warranted, so none was applied** — the parent verified the §12 live-check items against the production database directly: **32 public tables, all 32 RLS-enabled, all 32 carrying policies (72 policies), 89 indexes** — the live database matches the migrations exactly, zero drift.

Production verification: **PASS** —

- Response headers on `/` now include `Content-Security-Policy: … object-src 'none' …` alongside the unchanged baseline set (HSTS preload, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy).
- The auth-callback open-redirect fix is live: `GET /auth/callback?next=@evil.com` (no code) → 307 to `https://itg-traderos.vercel.app/login` — own origin only.
- The branded 404 is wired into the app shell (its payload ships in the production RSC stream: "This page doesn't exist… Your trades and journal are safe on the dashboard"); anonymous requests to unknown paths still 307 to /login first, which is the pre-existing page-protection behavior (route enumeration stays impossible for signed-out visitors).
- Audit-gap fix proven end-to-end: a screenshot uploaded to a test-account trade via the API (201) and then deleted (200) produced exactly one `trade.screenshot_deleted` audit row (baseline 0), and the account's screenshot count returned to its baseline of 2. Test account otherwise unchanged (10 trades / 390 XP); Ezat untouched; `/` and `/login` 200.

Remaining §12 live items: the Supabase dashboard Auth settings checklist and the Vercel `NEXT_PUBLIC_APP_URL` value are dashboard-side reviews, carried into Phase 28's report alongside PITR; the CI pipeline (npm audit --audit-level=high + gitleaks on every push) is the dependency-audit control, since the sandbox's managed registry refuses `npm audit` (403 policy_denied) — `npm outdated` locally shows zero pending patch/minor updates.
