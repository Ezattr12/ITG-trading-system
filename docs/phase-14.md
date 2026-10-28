# Phase 14 — Production Verification

Status: **deployed, partially verified live — NOT yet fully verified for
real users.** Read the verdict at the bottom before treating this as a
launch sign-off.

Live URL: **https://itg-traderos.vercel.app**
Vercel project `itg-traderos` (`prj_p8yHVfeLkTMGRP8uGYwDx19nXHL7`),
deployment `dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4`, state **READY**,
target `production` (re-confirmed in this phase via `list_deployments`;
no redeploy was needed — Phase 14 changed no app code).
Supabase project `ITG-trading-system` (`pwzvthvvxyfppenmessf`,
ap-northeast-1, Postgres 17.11, status `ACTIVE_HEALTHY`).

How verification was done: the live site was checked over HTTPS, and
the live Supabase project was exercised through its Auth REST API and
PostgREST (the same APIs the app uses), with two clearly-marked test
accounts created for this phase. What could NOT be done from this
environment is in "Not verified live" below — it is a limitation of
the test environment, not a claim about the app.

## What this phase fixed (two real bugs found live)

### 1. CRITICAL — `TG_OP` case bug broke profile creation for every new trader (FIXED)

Migration 0015 wrote `if tg_op = 'insert' then` in both privilege-guard
functions. In PostgreSQL `TG_OP` is **always uppercase**
(`'INSERT'`, `'UPDATE'`, …), so the lowercase comparison was always
false: the INSERT branch was dead code and every INSERT fell through
to the UPDATE branch, where `OLD` is NULL and
`new.role IS DISTINCT FROM old.role` is always true for a
non-privileged caller. Live reproduction before the fix: a trader's
`profiles` INSERT failed with
`400 P0001 "role can only be changed by an administrator"` — even
with `role='trader'` explicitly set — and the same for a
`verification_records` INSERT.

Impact: the signup action's `profiles.upsert(...)` failed for every
new trader, so no profile row was ever created and onboarding, trades
(FK to `profiles`), goals and everything downstream could not work
for a new account. The action does not check the upsert error, so
signup *appeared* to succeed. Phase 13 missed it because the
Management API query endpoint runs with a privileged role, so the
trigger's `privileged` flag was true there.

Fix — migration `0018_fix_privilege_guard_tg_op.sql` (forward-only;
0015 untouched): both functions recreated with `tg_op = 'INSERT'`,
applied to the live project via the Management API query endpoint
(HTTP 201). Re-verified live afterwards: trader profile INSERT
succeeds (201), `verification_records` INSERT with
`status='not_provided'` succeeds (201), and self-promotion to admin
and self-verification are still blocked (400, see RLS section).

### 2. Production config seed was not idempotent (FIXED)

The first apply of migration 0017 duplicated `strategies` (9 → 18)
and `motivation_messages` (8 → 16) on re-run: `ON CONFLICT
(user_id, name)` never fires when `user_id` is NULL (NULLs are never
equal), and `motivation_messages` has no unique constraint at all.
Duplicates were deleted from the live DB, migration 0017 was
rewritten with `WHERE NOT EXISTS`, and the same fix was applied to
the dev-only `supabase/seed.sql` (which had the identical flaw).
Re-applied twice afterwards: counts stable at strategies 9, levels 4,
achievements 11, motivation_messages 8.

Note: the Phase 14 brief said "3 motivation messages" — the seed
actually contains **8** (the count in `seed.sql` and in this phase's
verification). The 8 were applied as written in the seed file.

## Production seed — verified

Migration `0017_production_config_seed.sql` (new, production-safe:
config rows only, no demo trades, no fake P&L, no fake users) applied
to the live project via the Management API query endpoint (HTTP 201),
applied twice to prove idempotency.

| Table | Rows | Verified |
|---|---|---|
| strategies (system, `user_id` NULL) | 9 | FVG, Order Block, Breaker, Liquidity Sweep, MSS, BOS, OTE, SMT, Other |
| levels | 4 | Bronze 0–39, Silver 40–59, Gold 60–79, Platinum 80+, scoring weights as spec §8 |
| achievements | 11 | first-trade 10 XP … discipline-30 100 XP |
| motivation_messages | 8 | general / after_loss / missed_day / goal_near / streak / discipline |

## Live checks — passed (84/88 in the harness; the 4 failures are explained below)

Test accounts: two confirmed test users created for this phase
(`lafofhf+itg14ac…@gmail.com` and `lafofhf+itg14bc…@gmail.com`,
plus 4 unconfirmed signup attempts from the first run). All six
test accounts and all their data were deleted at the end of this
phase; production is back to 0 users / 0 trades (see Cleanup).

HTTP (anon, via curl):
- `/` 200, `/login` 200, `/register` 200, `/forgot-password` 200.
- Protected routes redirect to login: `/dashboard`, `/admin`,
  `/trades`, `/goals`, `/coach`, `/certificates`, `/reports`,
  `/levels`, `/achievements`, `/risk`, `/onboarding`, `/profile`,
  `/notifications`, `/analytics`, `/calendar`, `/progress` — all 307
  to `/login?next=…`.
- All six security headers present on `/`: CSP, HSTS
  (max-age 63072000, includeSubDomains, preload),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

Auth (Supabase Auth REST, live):
- Signup accepted (200, user created) in the first run; signup
  returns **no session** — email confirmation is ON in this project,
  so a new user must confirm by email before logging in. The app's
  signup action tells the user this ("Check your email for a
  verification link…"). Email *delivery* was not verifiable from
  here (no mailbox access).
- Login with wrong password rejected (400); login with correct
  password succeeds (200, session returned); logout succeeds (204);
  re-login after logout succeeds (200).
- Password reset: **not verified** — every attempt returned 429
  `over_email_send_rate_limit` (see "Harness failures explained").

Data (PostgREST, live, as trader A):
- Profile create (201), defaults `role='trader'`,
  `verification_status='not_provided'`; edit own `full_name` (200).
- Risk rules saved (201): max leverage 10, max daily loss 100,
  max trades/day 5, max consecutive losses 3, max risk/trade 1%.
- Goal created (201), progress recorded 1/5 (201), goal completed
  (200). No XP row appeared for the completed goal — XP is awarded
  only by the app's Server Actions, not by direct API writes (see
  "Not verified live").
- Closed trade inserted (201): EURUSD long, entry 1.10, exit 1.11,
  size 1000, leverage 2, fees 0.5. Its `pnl`/`roi_pct`/`r_multiple`
  are **NULL** — P&L is calculated in the app's Server Action, not
  in the database, so a direct API insert correctly has no
  calculated values. Expected app-calculated P&L for this trade is
  9.5 ((1.11 − 1.10) × 1000 − 0.5); that calculation is unit-tested
  locally but was not exercised live (see "Not verified live").
- Open trade inserted (201); trade notes edited (200); screenshot
  row inserted (201); psychology record (201); lesson (201).
- Trade DELETE returned 204 from PostgREST but **deleted nothing**
  (PostgREST returns 204 when 0 rows match) — both test trades were
  still present afterwards. No delete policy exists, as designed.

Storage (live):
- Upload to own path `trade-screenshots/<own-id>/phase14-test.png`
  (200, object stored); upload to the other user's path rejected
  (400); the other user cannot download the private file (400);
  owner can create a signed URL (200).

Server-written tables (live, as trader A): `xp_transactions`,
`user_levels`, `user_achievements`, `certificates`, `ai_insights`,
`risk_events`, `discipline_events`, `report_runs` all read as empty
(200, 0 rows); direct insert into `xp_transactions` rejected (403).
Trader cannot read `system_settings` (200, 0 rows).

Cross-user isolation (live, trader B vs trader A):
- B lists trades: 0 of A's; B cannot read A's trade by id; B cannot
  update A's trade (0 rows); B cannot read A's profile; B lists
  goals: 0 of A's. Anon cannot read trades.
- Full 32-table × (A / B / anon) select matrix: see
  `docs/production-verification.md`. Every table returned 200 with
  only the caller's own rows (or the shared config rows) — except
  `system_settings`, which returns 400 for non-admins (RLS denies
  it entirely; the 400 is PostgREST's response to a denied table,
  not a leak).

Privilege escalation (live, after the 0018 fix):
- Trader self-promotion to admin: blocked (400, trigger).
- Trader self-verification: blocked (400, trigger).
- Trader inserting a `verification_records` row with
  `status='verified'`: blocked (400, trigger).
- Service-role promotion of test user A to admin (audit-logged,
  reverted immediately after): admin could then read
  `system_settings` (200, 4 rows) and all trades; the promotion and
  the revert were both written to `audit_logs`, and A was reverted
  to `trader` at the end of the test.

## Harness failures explained (not product failures)

The automated harness reported 84/88. The 4 failures:

1. **Signup 429 (×2, second run)** — Supabase's email-send rate
   limit (`over_email_send_rate_limit`) after the first run's
   signups. Signup itself was verified in the first run (200).
2. **Password reset 429** — same email rate limit; the reset
   endpoint is reachable and the limit is Supabase's own, but a
   successful (200) reset was not observed in this phase.
3. **Trade DELETE "204"** — harness misread PostgREST's 204 (0 rows
   affected). Verified afterwards by direct query: both trades were
   still present. Delete is correctly blocked.

## Not verified live — the honest gap

The test environment used for this phase cannot make the requests a
real browser makes to the live app: from this VM, **any** POST to
`itg-traderos.vercel.app` and **any** GET carrying a `Cookie` header
hangs indefinitely (tested to 110 s), while anonymous GETs are fast
(0.5–2.6 s). The same requests to `example.com` and `vercel.com`
hang identically, and Supabase API calls (Auth, PostgREST, Storage)
work normally — so this is a limitation of this test environment's
network egress, not of the deployment. It means the following were
**not** exercised against the live site and must be checked from a
real browser before launch:

- Login through the live `/login` form (Server Action) and the
  signed-in dashboard, trades, goals, levels, coach, certificates,
  reports and admin pages as a real user.
- Trade creation through Quick Entry — in particular the app's
  auto-calculated P&L/ROI/R/RR, the risk engine blocking a
  leverage/daily-loss breach, and XP +10 / achievement "First Trade"
  being awarded by the Server Actions.
- Onboarding (5 steps), profile edit, avatar upload, screenshot
  upload through the app UI, weekly review (+30 XP), AI Coach
  refresh, certificate issuance (must not issue for unmet criteria),
  and the admin panel UI (non-admin denial in the browser).
- Password-reset email actually arriving in a mailbox.

All of the above are covered locally (326/326 Vitest tests +
Playwright smoke tests in Phase 12, against the production build),
but local tests are not live verification.

## Backup / restore drill

Management API `GET /v1/projects/{ref}/database/backups` returned
(2026-10-27):

```json
{"region": "ap-northeast-1", "walg_enabled": true, "pitr_enabled": false, "backups": [], "physical_backup_data": {}}
```

- **PITR is OFF** (`pitr_enabled: false`) and **no backup snapshots
  are listed** (`backups: []`). Plan v2 §9 requires PITR on prod
  and daily backups. This is an open gap: if the live database were
  lost or corrupted today, there is no verified restore point.
- No restore was attempted (destructive) — procedure only, below.
- Enabling PITR is a Supabase project setting (Pro-plan feature);
  it was not changed in this phase because it may change billing.
  Ezat (or the parent) should enable it in the Supabase dashboard
  and re-run this check until `pitr_enabled` is `true` and a backup
  appears in the list.

Restore procedure (documented, not executed):
1. In the Supabase dashboard: Project → Database → Backups →
   choose a point-in-time (PITR) or a listed backup → Restore.
   Restoring replaces the live database — do it only with Ezat's
   approval, and only after exporting a fresh copy of the current
   data.
2. Alternative (no dashboard): Management API backup/restore
   endpoints for the project, same approval rule.
3. After any restore: re-run the Phase 14 live checks (seed counts
   9/4/11/8, RLS matrix spot-checks, anon route checks) before
   telling users the site is back.
4. Code is not in GitHub yet (see below), so a Vercel rollback is
   the deployment-level recovery: Vercel dashboard → Deployments →
   the last READY deployment → Promote to Production. The staging
   tree `~/workspace/.itg-deploy-staging/` must not be deleted until
   the GitHub route works.

## GitHub — still blocked (unchanged)

The code is **NOT in GitHub**. The push still fails 403
(`Resource not accessible by integration`) and no retry was possible
from this phase (no GitHub write tool in this session). The fix is
unchanged since Phase 1: the GitHub App installation must have
`ITG-trading-system` selected with Contents write access:
https://github.com/apps/meta-muse-ai/installations/new — then the
push can be retried and Vercel switched to the GitHub route, which
retires the staging tree. Until then, do not claim the code is
committed. The live deployment does not depend on GitHub.

## Cleanup

All six Phase 14 test accounts were deleted via the Auth Admin API
at the end of verification. Cascade delete removed their profiles,
trades, goals, risk rules, screenshots rows and psychology records;
the uploaded test screenshot was deleted from Storage separately.
Final live state verified by direct query: **0 auth users,
0 profiles, 0 trades, 0 goals, 0 risk rules, 0 storage objects**;
config seed intact (9 / 4 / 11 / 8). The two audit rows written for
the test admin promotion/revert remain (append-only audit trail, as
designed).

## Migrations applied in this phase

- `0017_production_config_seed.sql` — production-safe config seed
  (9 / 4 / 11 / 8), idempotent after the fix described above.
- `0018_fix_privilege_guard_tg_op.sql` — fixes the `TG_OP` case bug
  in both privilege-guard functions. 32 tables total, unchanged.
- No redeploy: no app code changed in this phase. The repo file
  `supabase/seed.sql` was also fixed for the same `ON CONFLICT`
  flaw (dev-only file; no live effect).

## Remaining known issues / follow-ups

1. **Signed-in app flows not verified live** (see "Not verified
   live") — needs a real browser session. This is the main
   launch blocker for a full sign-off.
2. **PITR off, no backups listed** — enable PITR in Supabase and
   re-verify.
3. **Password-reset email not verified** — needs a mailbox check
   (or a reset attempt after the email rate-limit window passes).
4. **GitHub commit still blocked (403)** — code not in GitHub;
   deployment depends on the staging tree until fixed.
5. **Signup action ignores the profile-upsert error**
   (`lib/auth/actions.ts` — `await supabase.from("profiles").upsert(...)`
   with no error check). The trigger fix makes the upsert succeed,
   so this is now defensive only, but it is what hid bug #1 in
   production. Fix it (and redeploy) as a follow-up.
6. Email rate limit: repeated signups/resets in a short window hit
   Supabase's `over_email_send_rate_limit` (429). Normal for a
   single real user; a launch-day signup burst could hit it on the
   free tier — worth knowing, not a code bug.

## Verdict

**Not ready for real users yet — with two specific reasons, both
fixable:**

1. The signed-in flows (login form → dashboard → trade entry →
   XP/achievements → coach/certificates → admin) have not been
   exercised against the live site from a real browser. The
   database-level verification (RLS, isolation, privilege guards,
   Storage, seed) passed live, and the app logic passed locally,
   but the live browser path is unverified.
2. There is no verified database backup / PITR restore point.

Everything else checked live passed: anon routes and security
headers, Auth signup/login/logout, profile and trade CRUD through
the live API, goals, risk rules, Storage upload/download rules,
the full RLS matrix, privilege-escalation blocks, admin promotion
with audit logging, and the production config seed. The two
critical bugs this phase found (profile creation blocked for every
new trader; seed duplication) are fixed in the live database and
in the repo (migrations 0017–0018).
