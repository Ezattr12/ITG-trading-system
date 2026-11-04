# Task 24 — Professional Certificate / Verification (ITG-issued only)

Status: BUILDER COMPLETE, fully gated locally. No git, no
deploy, no production writes. Migration 0022 is AUTHORED
ONLY — the parent applies it to production after a fresh
snapshot, exactly as with 0020/0021.

Governing hand-off: docs/task-23-assessment-engine.md §7.
Finding F4 remains open and untouched (not a Task 24 input).

---

## 1. What existed (audit)

The monthly certificate system, end to end (all file/line
references pre-Task-24):

- **Storage** — `certificates` (migration 0009): `id`,
  `user_id` (FK profiles, cascade), `certificate_id` unique,
  `month date NOT NULL`, `criteria_met jsonb`, `pdf_path`,
  `status` enum (pending/issued/revoked), `issued_at`;
  `unique (user_id, month)`. RLS: exactly one policy,
  `certificates_select_own` (owner or admin) — no client
  writes; issuance is server-side via the service role. The
  rls-matrix test pins the table as client-read-only.
- **Eligibility** — `lib/certificates/eligibility.ts` (pure):
  four criteria (journaling ≥80% of ≥5 closed trades, risk
  discipline ≥90% + zero critical events, routine ≥8 days /
  ≥2 weeks, ≥1 completed weekly review), exact percentages,
  honest failure details. Inputs assembled completely
  (fetchAllRows) in `queries.ts`.
- **Issuance** — `issueCertificateAction`: re-checks
  eligibility from stored data, idempotent per (user, month)
  via existing-row check + the unique constraint, writes the
  `certificate.issued` audit row ({month}) and an achievement
  notification, IDs `ITG-YYYYMM-XXXXXX` with collision retry.
- **PDF** — `lib/certificates/pdf.ts` (pdfkit), generated on
  demand from the stored row (never stored). The route
  (`app/certificates/[certificateId]/pdf/route.ts`) is
  owner-scoped through the session client
  (`getCertificateById` filters user_id + certificate_id), so
  another user's id and a nonexistent id are the same 404.
  Task 6 verified the whole flow in production.
- **Surfaces** — `/certificates` (current-month eligibility
  hero + issued list), the profile page's certificate list
  (`certificate_id, month` rendered raw), and the admin
  certificates list (`listAdminCertificates`, revoke by row
  id, `c.month.slice(0, 7)` in the page).
- **Levels**: zero references. Certificates never mentioned
  levels (Task 22 audit, Task 23 §7) — level certificates are
  entirely new surface.
- **Verification**: no `/verify` route existed. Middleware
  public paths were `/`, the auth pages and `/auth/*` only.

**Copy audit (honesty).** The existing monthly copy was read
in full — page lede, PDF header/footer, notification text.
It makes no external accreditation, qualification or
regulatory claim: the issuer is named as ITG / ITG TraderOS,
and the PDF footer already states the certificate "records
that the month's requirements were met; it is not a guarantee
of future performance." Nothing needed fixing; the level
surfaces below carry the same line plus one explicit
sentence — "not an external qualification or accreditation" —
because a level credential is the one most easily misread as
a professional qualification.

## 2. The semantics decision — WAS assessed, never "currently"

§7 required an explicit choice. The decision: **a level
certificate asserts the historical fact of one pass** — the
trader WAS assessed at band B on the assessment date, with
the score the pass recorded. Reasons:

- It is the only claim the stored evidence supports forever.
  A pass row is append-only and immutable; a certificate
  pinned to it stays true even when the trader's score later
  falls (the §7 case: "a trader can hold a pass for a band
  they no longer display"). A "currently assessed" claim
  would silently become false on a printed PDF.
- It matches the monthly certificate's semantics exactly:
  October's certificate stays true of October.
- Verification renders from the certificate row alone (the
  snapshot), so a third party checks the same fact the holder
  was issued — no live re-evaluation is involved, and nothing
  can be rewritten by a later band rename or threshold edit
  (band names ARE admin-editable, which is why the row stores
  slug + name snapshot, per §7).

Every surface states this in words: the PDF ("records that
the trader was assessed at this band on the date shown; it
does not by itself state the trader's current level"), the
/certificates explainer ("It records that you were assessed
at that band on that date; it does not claim your current
level"), and the verification page ("This records the
assessment on that date; it does not by itself state the
trader's current level").

## 3. Migration 0022 — extend, don't replace

`supabase/migrations/0022_level_certificates.sql` (authored,
NOT applied):

1. `certificate_kind` enum ('monthly', 'level') — do-block,
   duplicate-safe, house style.
2. `kind certificate_kind NOT NULL DEFAULT 'monthly'` —
   every existing row becomes monthly with no data rewrite.
3. `month DROP NOT NULL` — level certificates have no month.
   Monthly rows always carry one, so `unique (user_id,
   month)` still enforces one monthly certificate per user
   per month exactly as before (NULLs are distinct under a
   unique constraint, which is what permits several level
   certificates per user).
4. Evidence columns: `assessment_id` (FK →
   level_assessments, ON DELETE SET NULL), `level_slug`,
   `level_name`, `assessed_at`, `assessment_score
   numeric(19,6)` — snapshotted at issuance.
5. Partial unique index `certificates_user_assessment_uidx`
   on `(user_id, assessment_id) WHERE assessment_id IS NOT
   NULL` — the idempotency rule in the database.

No new table (the RLS matrix count stays 34), no policy
changes (certificates remain select-own-or-admin,
client-read-only — the matrix pin holds), no change to any
existing row's meaning.

**Deploy-window order matters: migration FIRST, then code.**
Two existing queries now name the new columns explicitly
(`listAdminCertificates`, the profile certificate list), so
deploying code first would error those reads until the
migration lands. This is the established 0020/0021 pattern.

Two pre-existing render paths had to learn about null
months, or level rows would have broken them:
`listAdminCertificates` + the admin page (`c.month.slice`
would have thrown) now render the band name for level rows;
the profile list renders the band name instead of a month
for level rows. Both are presentation-only accommodations
for rows that cannot exist before this task.

## 4. Issuance (level-actions.ts)

`issueLevelCertificateAction` lives in its own module so the
monthly action — and its tests — are untouched.

- Input: only `assessmentId`. The pass is re-read through
  the service role filtered by id AND the signed-in user;
  the verdict must be 'pass'. A hold, another trader's pass
  and an unknown id all return ONE error ("not a passed
  assessment on your record") and write nothing.
- Snapshot: slug, name, score (`Number()`-converted from the
  numeric column) and the assessment's `created_at` are
  copied onto the certificate row, and mirrored into
  `criteria_met` (the record is self-describing even read
  raw); the columns are authoritative.
- Idempotency: existing-row check on (user, assessment_id)
  returns the existing certificate with no new row, audit or
  notification; a unique-violation race resolves the same
  way (re-read and return the winner's certificate); a
  certificate_id collision retries with a fresh id (the
  monthly pattern, 3 attempts). The ID carries the issuance
  month, like a monthly ID carries its month.
- Credential trail: `certificate.issued` audit with details
  {kind: 'level', level_slug, assessment_id} (minimal keys,
  the house rule) and an achievement notification ("Level
  certificate issued"), then `revalidatePath("/certificates")`.

## 5. Verification — privacy analysis

`app/verify/[certificateId]/page.tsx` is public by design
(middleware gains the `/verify/` prefix; `robots: noindex`).

- **Read path**: one service-role lookup by `certificate_id`
  (`getCertificateVerification` in
  `lib/certificates/verification.ts`) + one profiles lookup
  for the display name. There is deliberately NO anonymous
  RLS policy on certificates — the table stays unenumerable
  through PostgREST, and the page is the only public reader.
- **Whitelist** (asserted by exact key set in tests): found,
  certificateId, status, kind, traderName (profile
  `full_name` as stored — the name the certificate itself
  carries), month (monthly) or levelName + assessedAt
  (level), issuedAt. NEVER returned: user_id, email,
  criteria_met, the assessment score (it lives on the
  holder's own PDF, not the public page), any trade/P&L data.
- **Uniform negatives**: unknown, mistyped and fabricated
  ids get the identical "Not verified" state; a pending row
  (which the issuance paths never create) also lands there —
  only status 'issued' verifies, and 'revoked' renders as
  Revoked, never as valid.
- **Abuse posture**: `checkRateLimit` from
  `lib/auth/rate-limit.ts` (the app's existing limiter)
  keyed on the first `x-forwarded-for` address, 30 checks /
  minute, evaluated BEFORE the database read. Same
  documented limitation as the auth limiter: per-instance,
  best-effort on multi-instance hosting; the call site would
  not change if the store is ever shared. Combined with
  24-bit id suffixes and a uniform negative, enumeration
  yields nothing beyond the certificate's own public facts.

## 6. Surfaces

- **/certificates**: a "Level certificates" section between
  the monthly hero and the issued list — explainer, then per
  state: not-configured notice; "No passed assessments yet"
  (A's state); "every passed assessment already has its
  certificate"; or one row per uncertified pass (band in
  gold, assessed date, score, `IssueLevelCertificateForm`).
  The issued list branches by kind (band name + "Assessed
  <date>" for level rows) and every issued row gains a
  Verify link next to Download PDF — both kinds, since the
  verify surface accepts any certificate id. The monthly
  hero, form, eligibility and empty states are unchanged.
- **PDF route**: branches on `kind === 'level'` →
  `buildLevelCertificatePdf` from the snapshot columns
  (title "Level Certificate", assessment record lines
  "Assessment passed on <date>" / "Score at assessment:
  X / 100", the was-assessed + internal-credential footer,
  and the verify URL printed on the document). Owner-only
  404 semantics unchanged; the monthly branch is byte-for-
  byte the pre-task code path.
- **Admin**: level rows list and revoke exactly like monthly
  ones (the revoke path was already kind-agnostic).
- **Mobile**: no certificate surface exists there and none
  was added — issuance/verification are web surfaces; the
  record is shared server-side state.

## 7. Files

Created:
- supabase/migrations/0022_level_certificates.sql
- apps/web/lib/certificates/level-actions.ts
- apps/web/lib/certificates/level-actions.test.ts (6 tests)
- apps/web/lib/certificates/verification.ts
- apps/web/lib/certificates/verification.test.ts (6 tests)
- apps/web/lib/certificates/level-pdf.test.ts (1 test)
- apps/web/components/certificates/issue-level-certificate-form.tsx
- apps/web/app/verify/[certificateId]/page.tsx
- docs/task-24-certificates.md (this file)
- ~/workspace/.itg-helpers/qa-t24-certificates.mjs (outside
  git — visual QA script)

Modified:
- apps/web/lib/certificates/types.ts — CertificateKind;
  CertificateRow gains kind + the level evidence fields;
  month becomes nullable.
- apps/web/lib/certificates/queries.ts — getPassAssessments
  (session-client, verdict='pass', newest first).
- apps/web/lib/certificates/pdf.ts — buildLevelCertificatePdf
  (monthly builder untouched).
- apps/web/app/certificates/[certificateId]/pdf/route.ts —
  kind branch; the response builder deduplicated; monthly
  path otherwise identical.
- apps/web/app/certificates/page.tsx — level section,
  issued-list kind branching + Verify links, one empty-state
  sentence extended to name both earning routes.
- apps/web/middleware.ts — /verify/ public prefix (+comment).
- apps/web/lib/admin/types.ts, lib/admin/queries.ts,
  app/admin/certificates/page.tsx — level rows render (band
  name in place of the month) instead of crashing.
- apps/web/app/profile/page.tsx — certificate list renders
  the band name for level rows (month for monthly, as
  before).

NOT changed: eligibility.ts, the monthly action and its
tests, the monthly PDF builder, RLS policies, the XP /
assessment / notification engines (issuance uses the
existing createNotification), @itg/calc, mobile.

## 8. Gate results (local, this builder)

- Vitest: **992/992** (91 files). Baseline 979 + 13 new:
  6 level-issuance (issue + snapshot, idempotent re-issue,
  hold refused, other-user refused, unknown refused,
  missing id refused), 6 verification (whitelist key-set for
  both kinds, revoked passthrough, uniform not-found,
  missing profile, blank id), 1 level PDF smoke. The monthly
  suites (actions 3, eligibility 13 + 12 boundary, pdf 2)
  pass UNMODIFIED.
- Typecheck: clean (web + calc). Lint: 0 errors (1
  pre-existing dashboard `<img>` warning, not this task).
- Build: clean; First Load JS shared 103 kB — unchanged;
  `/verify/[certificateId]` present as a dynamic route.
- security:check: passed (441 files; baseline 433, +8 new
  files).
- Playwright e2e (CI=true, repo root): **36/36**.
- Visual QA (local production build on :3100, script
  qa-t24-certificates.mjs): **22/22 at 390px and 1280px** —
  /certificates as A (monthly panel unchanged, level section
  + honest "No passed assessments yet", no issue button
  offered, issued empty state, zero overflow) and
  /verify/ITG-202611-ZZZZZZ signed out (renders in place —
  no /login redirect — uniform "Not verified", the
  internal-credential line, zero overflow). Screenshots
  eyeballed: v2 hero, muted chip, dock geometry normal.
- Account A untouched (read-only SQL after all work):
  10 trades / 390 XP / 23 notifications / 1 assessment row
  (the hold) / **0 certificates** — A is still certifiable
  for nothing, exactly as required.

**Could NOT be rendered locally** (stated plainly): the
uncertified-pass row with its issue button, an issued level
certificate row, the level PDF, and the Verified/Revoked
verification states — all need a passed assessment and an
issued certificate in the database, which the builder may
not create in production. They are pinned by the unit tests
above and exercised live by §9's throwaway script.

## 9. Production verification script (for the parent)

Preconditions: fresh snapshot first
(~/workspace/itg-backups/snapshot.py). Apply in one window:
migration 0022, then the code deploy. NOTE: sbmgmt takes
single statements — apply 0022 statement by statement in
file order (kind enum do-block; add kind column; month drop
not null; add the five evidence columns; create the partial
unique index).

1. Baseline (read-only SQL), before anything:
   - A: trades 10, XP sum 390, notifications 23,
     level_assessments 1 row (hold), certificates 0.
   - certificates: all rows kind-less (pre-migration),
     count recorded; levels still 10 rows, one distinct
     scoring_config.
2. Apply migration 0022. Verify:
   - information_schema: certificates has kind (default
     'monthly'), month IS_NULLABLE = YES, and the five
     evidence columns; the partial unique index exists.
   - Every pre-existing certificates row reads kind
     'monthly'; the table count is still 34 tables overall
     and certificates still has exactly one policy
     (certificates_select_own).
3. Deploy; poll READY; resolve the alias to the new id.
4. Smokes: prod-smoke-t10.py, prod-smoke-levels.py and the
   certificates smoke → ALL PASS. A's /certificates SSR:
   monthly panel as before, "Level certificates" section
   with "No passed assessments yet", no issue button, issued
   list empty. A's counts unchanged (10 / 390 / 23 / 1 / 0).
5. Earn a real pass (throwaway, the Task 23 way): create
   via Auth Admin API (+ profiles + onboarding rows); seed a
   state meeting the Foundation standard with breadth
   (closed trades + psychology giving ≥3 measured dimensions
   — Foundation's standard is breadth-only); trigger a
   refresh (visit /levels as the throwaway) → assessment
   row 1 is a QUALIFYING HOLD (standard_met true, verdict
   hold on confirmation alone); age THAT row's created_at
   to 8 days ago by SQL (test-data-only manipulation on the
   throwaway's own row — the Task 23 §5 step 7 pattern);
   refresh again → row 2 is verdict PASS.
6. Issue end-to-end (same throwaway): /certificates shows
   the pass with an issue button → issue → exactly ONE
   certificates row: kind 'level', month NULL,
   assessment_id = row 2's id, level_slug 'foundation',
   level_name/score/assessed_at matching row 2's snapshot;
   one certificate.issued audit row (details kind 'level');
   one achievement notification. Re-submit (reload + issue
   again): the section now reports the pass as certified and
   NO second row/audit/notification appears.
7. PDF: as the throwaway (owner) → 200, application/pdf,
   %PDF magic, filename = the certificate id. As A (another
   user) → 404. Signed out → 401. A monthly certificate PDF
   (any pre-existing issued one, if present) still renders
   unchanged.
8. Public verification (signed out, fresh context):
   - /verify/<level-cert-id> → "Verified", holder = the
     throwaway's stored profile name, "assessed at the
     Foundation band on <row 2's date>", issued date,
     status Issued — and NO email / score / trade data
     anywhere in the HTML.
   - /verify/ITG-000000-XXXXXX (unknown) → the uniform
     "Not verified" state, HTTP 200, no redirect to /login.
   - Admin-revoke the throwaway's certificate (reason
     required, audit row as before) → /verify/<id> now shows
     "Revoked". 
9. Admin: /admin/certificates lists the level row (band
   name where the month used to be) without errors.
10. Delete the throwaway (cascade) and re-verify: user
    count restored, A's baseline byte-identical
    (10 / 390 / 23 / 1 assessment / 0 certificates), and no
    certificate rows remain for the throwaway.
11. Commit + report in the mandated format; Task 25 next.

## 10. Known limitations / deliberately not built

- **No /verify index/search page**: verification is by
  direct link (printed on the level PDF, linked from
  /certificates). A lookup form adds an enumeration surface
  for no holder benefit.
- **The monthly PDF is byte-identical to before** — it does
  not print a verify URL (changing it would alter a document
  holders may already have downloaded); monthly certificates
  verify at the same /verify/<id> address, linked from
  /certificates and the profile.
- **Rate limiting is the app's existing per-instance
  in-memory limiter** (documented there as best-effort on
  multi-instance hosting). A shared store remains the
  standing platform item it already was, not a Task 24
  invention.
- **Revocation semantics unchanged**: admin revoke flips
  status; verification then reports Revoked. There is no
  un-revoke, as before.
- **One certificate per pass row**: a trader who passes the
  same band twice (two pass assessments) can hold two
  certificates for that band, one per assessment — each
  certifies a distinct, dated fact. Certifying only the
  first pass would discard real evidence.

## 11. Task 25 hand-off — Trading Regime Intelligence

- Certificates are now the outward-facing credential layer
  over two evidence systems: monthly criteria (stored
  aggregates) and level assessments (append-only snapshots).
  Any future credential (e.g. regime-related) should follow
  the same rules: issued only against a stored, append-only
  evidence row; slug + snapshot on the certificate row;
  was-true-of-its-moment semantics; verification through the
  §5 whitelist, never a new public read path.
- The verification whitelist's exact key set is pinned by
  test — a Task 25 field must be added deliberately, with
  the privacy analysis re-run, not by spreading a row.
- Finding F4 (achievement percentage criteria) is still
  open and was not a Task 24 input.

## 12. Audit/notification entity-id fix (Task 24, post-deploy production finding)

**Defect.** `audit_logs.entity_id` and
`notifications.related_entity_id` are `uuid` columns. Both
issuance paths — the monthly action
(`lib/certificates/actions.ts`) and the level action
(`lib/certificates/level-actions.ts`) — passed the HUMAN
certificate id (`"ITG-202611-DFAF58"`) as `entityId` /
`relatedEntityId`. Postgres rejects a non-UUID value in a
uuid column, and both writers (`writeAuditLog`,
`createNotification`) are best-effort by design, so the
failure was silent: the certificate row was written, but
its audit row and issuance notification never were.

**Production evidence.** Found by the parent's production
verification of this task, not by the test suite: a SQL
count of `audit_logs` rows with
`action = 'certificate.issued'` returned **0 — ever**,
including the Task 6 monthly issuance that is known to
have happened in production. The mocked unit tests could
not catch it: the fake client records whatever it is
given, and the monthly test's assertion
(`entity_id === result.certificateId`) encoded the bug as
the expectation. The admin revoke path was never affected
— it passes the certificate ROW uuid (`c.id` from the
admin list) and indeed surfaced as the correct pattern.

**Fix.** Both actions now capture the inserted row's UUID
— `.insert({...}).select("id").single()` — and pass that
row id as `entityId` / `relatedEntityId`. The human
certificate id stays traceable: it is recorded in the
audit `details` (`details.certificate_id`, alongside
`month` for monthly and `kind` / `level_slug` /
`assessment_id` for level). Idempotency and collision
behaviour are unchanged: the already-issued early return
and the level flow's duplicate-race branch write no audit
row and no notification, exactly as before — the winning
request writes them. The two test files were updated so
the mocked insert returns a row id and the assertions pin
the corrected contract: `entity_id` / `relatedEntityId`
equal the certificate row's id (and explicitly NOT the
human certificate id), while `details.certificate_id`
carries the human id.

**Sweep.** Every other `writeAuditLog` / `createNotification`
caller in `lib/` was checked (grep for `entityId:` /
`relatedEntityId:`, tests excluded): auth (user ids),
trades (trade/achievement/screenshot row ids), discipline
(goal/achievement ids), reviews (inserted review id),
intelligence background (risk event id), plan (logged
event id) and admin (zod-parsed row ids, including the
revoke path) all pass genuine row UUIDs. The defect class
was confined to the two certificate issuance paths.

**Gate after the fix** (local): Vitest 992/992 (certificate
suites 43/43), typecheck clean (web + calc), lint 0 errors
(1 pre-existing `<img>` warning on the dashboard),
production build clean, security:check passed (441 files),
Playwright e2e 36/36.
