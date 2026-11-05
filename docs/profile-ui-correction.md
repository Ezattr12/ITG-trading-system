# Profile UI/UX Correction — read-only Profile, dedicated Edit Profile page

Ezat's mandate (2026-11-05, with phone screenshots): the main
Profile page becomes a clean read-only overview; the "Tap the
photo to change it" caption and the badge explainer paragraph
are removed; the Verified badge sits beside the trader's name
at exactly 100% completion; all editing (fields + photo) moves
to a dedicated Edit Profile page. Web surface only. No change
to the completion calculator, the competency levels, XP, or
any other page.

## 1. Audit findings (code at HEAD 2e6a76db, before changes)

- **Route:** `apps/web/app/profile/page.tsx` (single page,
  no sub-routes). Middleware protects `/profile/*` by the
  default rule (anything non-public requires a session), so
  the new sub-route needed no middleware change.
- **Hero (page.tsx L194–259):** rendered the client
  `AvatarUpload` component — the photo *was* the edit
  control. Name `<h1>` at L204; role/country line L205–208;
  badge-or-completion-chip row **below** the name L209–220;
  explainer `<p>` L221–227 with two variants — verified:
  *"Profile complete — this badge confirms your profile
  information is complete. It is not identity (KYC)
  verification."*; unverified: *"The ITG Verified Profile
  badge activates when your profile information is complete.
  It is a completeness badge, not identity verification."*
  Both variants are the one explanatory element the mandate
  removes; the whole `<p>` went, replaced by nothing.
- **Caption:** the exact string "Tap the photo to change it"
  existed in exactly one place in the repo:
  `apps/web/components/profile/avatar-upload.tsx` (the
  status line's idle text). The component also wrapped the
  avatar in a `<button>` with a camera badge.
- **Inline edit form (page.tsx L415–527):** an `ActionForm`
  bound to `updateProfileAction` with four `<details>`
  groups — Personal Information, Trading Background,
  Work & Trading, Private Financial — fields: fullName,
  fatherName, dateOfBirth, country, tradingExperience,
  tradingEducation, backtestedTrades, realTradesCount,
  employmentStatus, tradingCapital, monthlyIncome, plus
  four hidden experience inputs (backtestingExperience,
  realTradingExperience, demoTrading, tradesRealMoney).
  `updateProfileAction` was used **only** by this page —
  the form is NOT shared with onboarding (onboarding has
  its own actions), so the move carries no cross-surface
  risk. The page-local `Field` helper existed only for it.
- **Trading Identity** carried an "Edit" link to the
  `#edit-profile` anchor (L336–339).
- **Save wiring gap:** `updateProfileAction`
  (`lib/auth/actions.ts` L347) returned `{ ok, message }`
  only — **no `redirectTo`, no `revalidatePath`**. That was
  fine while the form lived on /profile (the action
  re-rendered its own route); the mandated return-to-profile
  flow requires the redirect + revalidation, added in this
  task using the existing ActionForm machinery (it already
  navigates on `redirectTo` — same pattern as the
  password-update action). `uploadAvatarAction` already
  revalidated `/profile`; unchanged.
- **Badge wiring (already canonical):** the page computes
  `calcProfileCompletion(storedRow)` via the
  `lib/profile/completion` shim over
  `packages/calc/src/profile-completion.ts` — the ONE
  calculator — and the badge condition is
  `completion.verified` (percent === 100). Untouched.
- **No biography field exists.** There is no `bio`/
  `biography` column on `profiles`, no field in
  `profileEditSchema`, and no input anywhere in the app.
  The mandate lists biography among "existing editable
  profile fields"; it is not an existing field, and
  inventing one would be a schema change outside this
  task's scope. **Flagged, not improvised:** the edit page
  carries every field that actually exists (§2). If Ezat
  wants a biography field, that is a separate schema +
  form task (it would also be a product decision whether
  it counts toward completion — it must not be added to
  the calculator under this mandate).
- **Tests:** no unit/component test referenced the profile
  page, the old strings, or `updateProfileAction`. e2e
  covers `/profile` only as an unauthenticated redirect +
  overflow route. The consolidated production smokes
  (t8/t9/t10) do not touch /profile. Nothing encoded the
  old layout, so no existing assertion needed rewriting;
  the new behaviour is pinned by new tests (§4).
- **CSS:** `.itg2-profile-avatar` is element-agnostic
  (class selectors only) — a plain `<div>` gets identical
  paint. `.itg2-btn-ghost` already provides a 44px-minimum
  touch target. **Zero new CSS was needed.**

## 2. What changed — exact files

| File | Change |
| --- | --- |
| `apps/web/app/profile/page.tsx` | Hero photo → display-only `AvatarDisplay`; badge moved **inside the name `<h1>`**, inline immediately after the name text, still gated on `completion.verified`; explainer `<p>` deleted (both variants); completion chip now renders only below 100% (its progress role is unchanged; the completion aside still shows full progress); **Edit Profile button** (Pencil icon + label, `.itg2-btn-ghost`) at the top-right of the hero, linking `/profile/edit`; Trading Identity "Edit" link → `/profile/edit`; the entire inline edit-form section deleted, with its now-unused imports and the `Field` helper. Kept verbatim: key stats, Trading Identity, Achievements, completion ring/list, certificates, how-levels-work, XP/level hero block. |
| `apps/web/app/profile/edit/page.tsx` | **NEW route `/profile/edit`** (same authenticated segment; page-level `getCurrentUser` → `/login` redirect mirrors /profile). Standard v2 header (eyebrow, title, lede, Back to profile link), a "Profile photo" card rendering the existing `AvatarUpload`, and a "Profile details" card with the moved form — **field for field identical** to the old inline form (all 11 visible fields + 4 hidden experience inputs + both helper notes), submit label now **"Save changes"** per the mandate (was "Save profile"). |
| `apps/web/components/profile/avatar-display.tsx` | **NEW** — presentational, server-rendered display avatar: the shared `.itg2-profile-avatar` ring with the stored photo or initials fallback. No button, no input, no badge, no caption. |
| `apps/web/components/profile/avatar-upload.tsx` | The caption string deleted (the status line now speaks only for pending/error/success and the not-configured case). Component otherwise byte-identical: same `uploadAvatarAction`, same client+server validation, same storage path. Doc comment updated to record it renders only on /profile/edit. |
| `apps/web/lib/auth/actions.ts` | `updateProfileAction` success path only: `revalidatePath("/profile")` + `revalidatePath("/profile/edit")` and `redirectTo: "/profile"` added to the result. Validation, the shared `updateProfileCore(supabase, user.id, …)` write, and error paths are unchanged — the action still derives identity from the session, so cross-user editing is impossible by construction. |
| `apps/web/lib/profile/page-structure.test.ts` | **NEW** — 11 structural pins (§4). |
| `docs/profile-ui-correction.md` | This record. |

**Moved, not duplicated:** the form JSX, the `Field`
helper, `ActionForm`, `updateProfileAction`,
`updateProfileCore`, `AvatarUpload`, `uploadAvatarAction`,
`uploadAvatarCore`, the storage bucket/policies, and the
completion calculator each exist exactly once, as before.
The only new presentational code is `AvatarDisplay`
(the mandate requires a non-interactive hero photo, which
the upload control cannot be) — it shares the
`.itg2-profile-avatar` paint, not a copy of it. One
6-line initials derivation is repeated between the two
avatar components (pure string formatting; noted for
honesty).

**Badge beside the name — implementation note:** the first
implementation put the badge in a flex row next to the
`<h1>`; local QA at 390px with a realistic long name
("Correction Test Trader") wrapped the badge onto its own
line below the name. The shipped markup places the badge
`<span>` **inside the `<h1>`**, inline after the name text
(`ml-3 align-middle`), so it sits immediately beside the
name at every width and wraps *with* the name text if the
name itself wraps. Verified by bounding-box geometry at
390px and 1280px (§5).

## 3. The editing workflow (as shipped)

1. `/profile` → **Edit Profile** button (hero top-right,
   ≥44px target, both layouts) → `/profile/edit`.
2. Photo: the AvatarUpload control (only here) → existing
   `uploadAvatarAction` → existing storage + validation →
   `/profile` revalidated by the action (pre-existing).
3. Fields: **Save changes** → existing `updateProfileAction`
   → zod `profileEditSchema` → `updateProfileCore` for the
   session user → both routes revalidated → `redirectTo`
   → ActionForm navigates to `/profile`, which renders the
   saved values and photo immediately; persistence is the
   same database write as before (survives refresh and
   re-login by construction — the parent's production
   script re-proves it, §6 scenarios 8–9).
4. Errors/pending/success states come from the unchanged
   ActionForm machinery.

## 4. Tests

New: `apps/web/lib/profile/page-structure.test.ts`
(11 tests, rsc-boundary source-assertion style) pinning:
caption string absent from page/edit/avatar sources;
explainer strings absent; no form machinery
(ActionForm/updateProfileAction/`<Input`/`<select`) on the
main page; hero uses AvatarDisplay and never AvatarUpload;
read-only sections retained; badge gated on
`completion.verified` with the `.itg2-verified` element
appearing exactly once and **no** second percent
computation on the page (`percent === 100` absent — the
page consumes the canonical calculator's verdict); badge
markup inside the `<h1>` before the role line; Edit
Profile link present; edit page renders AvatarUpload and
every field name the action schema reads; the action body
contains the redirect, both revalidations, and the
session-scoped core call. The badge *condition* itself
(verified ⟺ exactly 100%, all 8 fields, placeholder and
whitespace rules) remains pinned by the canonical
`packages/calc/src/profile-completion.test.ts` matrix —
unchanged.

Battery (env sourced, repo root; re-run in full after the
final markup adjustment):

| Gate | Result |
| --- | --- |
| Vitest | **1036/1036** (94 files; baseline 1025 + 11 new) |
| Typecheck | clean |
| Lint | 0 errors (1 pre-existing warning, unchanged) |
| Production build | clean — `/profile/edit` in the route table (2.42 kB), shared First Load **103 kB** unchanged |
| security:check | passed (**450 files**; 447 baseline + edit page, display component, structure test) |
| Playwright e2e (CI=true) | **36/36** |

## 5. Local visual QA (production build on :3100, cookie-injection)

Script: `~/workspace/.itg-helpers/qa-profile-correction.mjs`
(+ `qa-profile-correction-setup.py` for the throwaway
lifecycle). **73 checks, ALL PASS**, at 390px and 1280px:

- **Account A (50%)**: loads as "ITG Test Trader"; caption
  and explainer absent; `.itg2-verified` count 0; chip
  reads "Profile 50% complete"; zero form fields and no
  file input on /profile; no Save button; hero photo not
  wrapped in any button; Edit Profile button present,
  ≥40px tall, and **clicking it lands on /profile/edit**.
- **/profile/edit as A (rendered only — never submitted)**:
  all 11 fields present with A's stored values prefilled
  (country "United Kingdom" asserted); avatar upload
  control present (file input + "Change profile photo"
  button); caption absent here too; "Save changes" and
  "Back to profile" present; zero overflow at both widths.
- **Throwaway at 100%** (Auth-admin created, all 8 fields
  SQL-seeded, deleted after): badge present exactly once;
  geometry places it inside the name heading's box
  immediately after the name at both widths; completion
  card shows 100%; no caption/explainer; zero overflow.
  Screenshots inspected: badge pill sits on the name line
  at 1280px; at 390px it flows beside the wrapped name.
- **Cleanup verified by SQL:** auth.users back to **4**,
  throwaway profile rows 0, **A untouched: 10 trades /
  390 XP**. A was never submitted against; the edit page
  was render-only under A's session.

## 6. Parent's production-verification script (the 11 scenarios)

After deploying this change through the normal staging
recipe and alias verification, run (throwaway pattern:
`qa-profile-correction-setup.py` works against production
unchanged; SSR reads via the session-cookie curl pattern,
stripping `<!-- -->` before substring checks):

1. **100% → badge beside name:** seed the throwaway to
   100% (setup script), open `/profile` (browser or the
   local-QA script repointed at production): `.itg2-verified`
   present once, inside the `<h1>`, name = the throwaway's
   stored full name.
2. **<100% → no badge:** A's `/profile` SSR: no
   `itg2-verified`; chip shows "Profile 50% complete".
3. **Caption gone:** SSR of `/profile` AND `/profile/edit`
   (both accounts): "Tap the photo to change it" absent.
4. **Explainer gone:** SSR: "badge confirms your profile
   information is complete" and "It is a completeness
   badge" absent. (The completion card's complete-state
   line — "Your profile is complete — the ITG Verified
   Profile badge is active." — is pre-existing completion
   copy, appears only at 100%, and is NOT the removed
   paragraph.)
5. **No editable fields on /profile:** SSR contains none
   of `name="fullName"`, `name="employmentStatus"`,
   `type="file"`, "Save changes".
6. **Edit button → dedicated page:** SSR contains
   `href="/profile/edit"`; browser-task click-through
   lands on `/profile/edit`.
7. **Photo changes only via Edit Profile:** /profile SSR
   has no upload affordance (scenario 5); on the
   throwaway, upload a photo on `/profile/edit` via the
   browser task → success state → `/profile` hero shows
   the new photo and `profiles.avatar_url` changed in SQL;
   storage object under the throwaway's own id prefix.
8. **Save returns to /profile, updated immediately:** as
   the throwaway, change Country on `/profile/edit`,
   Save changes → URL becomes `/profile`, role line shows
   the new country, SQL row matches.
9. **Persistence:** re-mint the throwaway session (fresh
   login), `/profile` still shows the new country + photo;
   SQL row unchanged since the save.
10. **Cross-user:** with a second throwaway B signed in,
    `/profile/edit` shows only B's values; B saves → A's
    and the first throwaway's rows byte-identical in SQL
    (the action takes identity from the session; there is
    no user-id input to tamper with — also confirm a
    hand-crafted POST with a foreign `userId` field is
    ignored/rejected by the schema path).
11. **Responsive:** production QA at 390px + 1280px for
    both pages and both accounts: zero horizontal
    overflow; dock intact; Edit Profile target ≥40px.

**Known limitations / notes for the parent:** (a) the
biography flag in §1 — Ezat's call whether to commission
a real bio field separately; (b) Ezat's own account is at
63% per the stored row, so on his phone the badge will
correctly *disappear* until his profile reaches 100% —
worth one line in the report so it doesn't read as a
regression (his mandate screenshot predates the current
stored state); (c) nothing else on any other page was
touched; mobile app untouched (it already has a separate
Edit Profile screen and imports the same calculator).
