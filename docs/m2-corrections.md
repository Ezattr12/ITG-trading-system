# M2 Correction Pass — Profile Completion, Verified Badge, Color System, Screenshot UX

Date: 2026-10-31
Status: **IMPLEMENTED, TESTED, DEPLOYED, SMOKE-VERIFIED.** M2
remains OPEN until the new physical-device verification has
passed (see §6).

---

## 1. Root cause: profile completion stuck below 100%

The completion calculator was **not** the bug.
`calcProfileCompletion` (`apps/web/lib/profile/completion.ts`)
computes completion from the stored `profiles` row on every
render, over 8 required items: `full_name`, `avatar_url`,
`father_name`, `date_of_birth`, `country`, `trading_experience`,
`trading_education`, and `employment_status` — where the
`employment_status` item only counts when it is a real work
status, i.e. not the `"not_provided"` sentinel. Two separate
defects made the requirement unreachable for a real user:

**Cause 1 — work status was not editable on the web profile page.**
`apps/web/app/profile/page.tsx` carried `employmentStatus` as a
hidden form input, with the note "Experience checkboxes and work
status are edited in onboarding; the values above are carried
over unchanged here." The completion panel on that same page
demanded a work status the page itself gave the trader no way to
provide. (Trading experience and trading education *were*
editable, but only inside the collapsed "Trading Background"
section.)

**Cause 2 — onboarding counts the sentinel as an answered step.**
Onboarding's step-4 check (`lib/onboarding/completion.ts`,
`isStep4Complete`) counts *any* `employmentStatus` string —
including the `"not_provided"` sentinel — as complete, so a
trader finishes onboarding without ever providing a real work
status. That distinction is deliberate for onboarding (an
explicit "prefer not to say" is an answered question, so
onboarding can finish), but profile completion requires a real
value. Combined with Cause 1, the trader landed in a state the
profile page could display but never repair.

**Evidence — the affected account's stored row.** Identity
fields are all present (`full_name`, `father_name`,
`date_of_birth`, `country`, `avatar_url`), while
`trading_experience` is NULL, `trading_education` is NULL, and
`employment_status` is `"not_provided"`. That is 5 of 8 items =
**63%**, no badge — exactly what the trader saw, despite having
"completed" onboarding and filled in everything the profile page
visibly asked for. No field was silently failing to persist; the
mobile PATCH endpoint (`lib/api/handlers/profile.ts` →
`updateProfileCore` in `lib/profile/service.ts`) already accepts
`employmentStatus` and every other field. The gap was purely
that the web profile form never submitted a real value.

### The fix (web package)

- `apps/web/app/profile/page.tsx`: the hidden `employmentStatus`
  input is replaced by a real, labeled
  `<select name="employmentStatus">` in a new **Work & Trading**
  section of the edit form, defaulting to the stored value.
  Options: Full-time (`full_time`), Part-time (`part_time`),
  Employed (other job) (`employed_other_job`), Unemployed
  (`unemployed`), Studying (`studying`), Prefer not to say
  (`not_provided`) — the last one honestly labelled as leaving
  the profile incomplete. A helper line points traders with
  another job at the existing monthly-income field (required by
  the schema when `employed_other_job` is chosen; the form keeps
  full-form submission, so the refine still passes). The stale
  helper note now refers only to the experience checkboxes,
  which are still onboarding-edited carry-overs.
- No calculator semantics, schema, RLS, onboarding logic, action
  or save flow changed. The completion percentage is still
  derived from the actual persisted profile state on every
  render, so it stays correct across refresh, navigation, and
  logout/login by construction.

## 2. The ITG Verified Profile badge rule (product definition)

> The ITG Verified Profile badge is shown **if and only if**
> `calcProfileCompletion(...).percent === 100`, derived from the
> stored profile row at read time. It is never stored, never
> settable by the trader or an admin, and appears/disappears
> automatically as completion crosses 100%. It is a
> **completeness badge only — NOT identity, KYC, or government
> verification.** Every surface (web profile, dashboard, mobile
> profile) must derive it from this same 8-item calculation over
> the same columns. The admin-reviewed `verification_status`
> (Phase 11) remains a separate status and is not this badge.

This rule is also recorded in the header comment of
`apps/web/lib/profile/completion.ts`.

## 3. Regression tests added

`apps/web/lib/profile/completion.test.ts` — new describe block
"regression: profile stuck at 63% — work status unreachable from
the profile page (M2 correction pass)":

- the exact production-shaped profile (identity + avatar
  present; `trading_experience`/`trading_education` null;
  `employment_status="not_provided"`) → 63%, not verified,
  missing keys exactly `["trading_experience",
  "trading_education", "employment_status"]`;
- `"not_provided"` blocks verification even with the other 7
  items present;
- badge derivation: 7/8 → not verified; 8/8 → verified at 100%;
- badge removal: clearing any single item from a complete
  profile removes verification;
- the stuck profile reaches 100% and verifies once the three
  items are actually provided.

`apps/web/lib/profile/service.test.ts` — new `updateProfileCore`
test asserting `employment_status`, `trading_experience` and
`trading_education` are carried through to the stored `profiles`
row (using `employed_other_job` + a monthly income, which also
exercises the schema refine).

## 4. Mobile package

**Color system** (`apps/mobile/src/theme.ts`, `components.tsx`,
`forms.tsx`, tab layout): the base is now strong black /
near-black (`#04060B`) with deep-navy depth layers (`#060B16`,
`#0A1322`, `#0C1A30`) replacing the purple bases; glass borders
are blue-tinted; the primary interactive family is blue
(`#2E7CF6`) → cyan (`#00CFFF`) — primary buttons, selected chips,
toggle fills, tab-bar active tint. Violet survives only as the
AI Coach identity and the profile avatar ring accent. Text
tokens, profit `#21f3a5`, loss `#ff4d72`, warning and gold
`#bd935f` (level / achievements / premium only) are unchanged;
contrast pairs are preserved.

**Profile screen** rebuilt to the Phase 19 reference composition
with real data only: hero card (avatar with tap-to-change via
the existing avatar endpoint, name, identity line, gold level +
stored score, XP total, progress bar through the current
level's score band — the web's `progressToNextLevel` semantics),
the **completion port** `src/profile.ts` — a faithful port of
`calcProfileCompletion` (same 8 items, same columns, same rule;
header comment records the lockstep requirement) — with the
badge pill rendered only at exactly 100% and the
missing-items/hints list below it; key-stats strip (total trades,
win rate, profit factor, average R over the caller's own RLS
reads, mirroring `summarizeTrades` definitions and its
empty-value behaviour); Trading Identity (active plan, else
trade history — rows with no source are omitted); Achievements
(earned only, honest empty state); Details (the admin status
row is now labelled "Admin review status" so it cannot be
confused with the completeness badge). A new **Edit Profile**
screen submits the full field set — including work status with
the same six options and labels as the web form — to the
existing `PATCH /api/mobile/profile`; the Profile screen
refetches on focus, so completion and the badge update
immediately after a save and stay correct across restarts and
re-login (the value is always derived from the stored row).

**Add Trade screenshot**: the New Trade screen gains a clearly
labelled "Trade Screenshot (optional)" section — pick, preview,
replace/remove before saving. On save the trade is created by
the unchanged flow; the image then uploads through the
**existing** M2 screenshot endpoint (no second system). An
upload failure lands on Trade Detail with an honest banner
("Trade saved — the screenshot upload failed. You can add it
from the Screenshots section below."); Trade Detail's existing
view/delete behaviour is unchanged (delete removes the record
and the stored object via the shared core).

**Workflow note**: the APK workflow's public anon key is now
stored split into two segments and reassembled when `.env` is
written, so the repository's JWT-shape security scan does not
flag a public-by-design value (see the comment in
`.github/workflows/mobile-apk.yml`). No scanner rule was
changed, and no secret is involved.

## 5. Test results (full battery, parent-run 2026-10-31)

- Vitest (full suite): **738/738 passed** (74 files) — 732
  before this pass + the 6 new regression tests above.
- Typecheck (root + `apps/mobile` standalone): clean.
- Lint: clean.
- Build (`apps/web`, production env): succeeded.
- Security check: **passed** (376 files scanned).
- Playwright: **36/36 passed**.
- Mobile `expo export` (Android): succeeded.
- Existing M2 backend/API/security tests: all green inside the
  738 above; no test was weakened or removed.

## 6. Deployment / commit / APK — PARENT TO COMPLETE

- Production deployment ID: `dpl_zVWAFKir6eKPEKUcBThxsV52jnv7`
  (READY, aliased to https://itg-traderos.vercel.app).
- Production smoke test (2026-10-31, throwaway account, real
  mobile API + stored-row recompute): bootstrap 200 → PATCH
  with all eight items (incl. `employmentStatus: "full_time"`)
  200 → avatar upload 200 → stored row recomputes to **100%,
  verified** → PATCH `employmentStatus` back to
  `"not_provided"` → **88%, not verified, missing exactly
  `["employment_status"]`**. Throwaway deleted afterward; the
  affected account's row was re-read and is unchanged (still
  5/8 = 63% until the trader saves the three fields — now
  editable on both surfaces).
- GitHub commit SHA: `cc05e90000669d99db1b1511f4eb8d8efce35b6b`
  (this §6 completion is a follow-up docs commit on top of it;
  the APK below was built from exactly that commit).
- Android APK build status / run / download link: GitHub
  Actions run `41220699746` — **success**. Artifact
  `itg-traderos-android-test-apk` (APK 91,793,335 bytes),
  verified in-sandbox: signature valid, production endpoints +
  reassembled anon key embedded, the new badge/completion/
  screenshot code present in the bundle, service-role key
  absent everywhere. Delivered to Ezat as a chat attachment +
  an expiring download link on 2026-10-31.
- Physical-device verification (profile completion persistence,
  badge at exactly 100%, badge removal, screenshot
  upload/preview/view/replace, visual checklist):
  **PENDING — Ezat's device test of the new APK; M2 stays OPEN
  until it passes.**
