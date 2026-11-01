# Profile Correction Pass — completion integrity, mobile Profile redesign, glass nav

Ezat's mandate (2026-11-01 02:53 EST) superseded the plain Page 7 step of the
Master Web UI Redesign: fix profile completion so it reliably reaches 100%,
redesign the mobile Profile to the reference's premium standard, and fix the
bottom-nav Add Trade button. No other redesign page work proceeded until this
correction was fully verified.

## 1. Completion audit (evidence before changes)

Pipeline traced end to end: `profiles` table → `updateProfileCore` (one core
for the web action and the mobile PATCH handler) → calculator → web Profile +
Dashboard, mobile Profile → Verified badge.

Required-field mapping (actual schema, live-verified):

| Item | DB column | Type | Default | Counted when |
|---|---|---|---|---|
| Full name | full_name | text, nullable | — | non-empty after trim |
| Profile photo | avatar_url | text, nullable | — | non-empty after trim |
| Father's name | father_name | text, nullable | — | non-empty after trim |
| Date of birth | date_of_birth | date, nullable | — | present |
| Country | country | text, nullable | — | non-empty after trim |
| Trading experience | trading_experience | text, nullable | — | non-empty after trim |
| Trading education | trading_education | text, nullable | — | non-empty after trim |
| Employment status | employment_status | enum, NOT NULL | `'not_provided'` | a real status — the `not_provided` placeholder deliberately does NOT count |

Every required field is editable on web (Profile form) and mobile (Edit
Profile) — repaired 2026-10-31 in the M2 correction pass; before that, three
fields had no editor, which is the historical root cause of "stuck below
100%". `verification_status` is a separate admin-reviewed column, never part
of completion. The badge is derived at read time (percent === 100), never
stored or settable, and is a completeness badge — not identity/KYC.

**Empirical finding:** with the current production code, a full-form save of
every field rendered exactly 100% + badge on web, and removing one field
dropped it to 88% + badge off (test account, production API + SSR). The
math and save pipeline were correct; the remaining defect was structural —
the calculator existed **twice** (web library + a hand-copied mobile port),
one drift away from the web/mobile disagreement the mandate prohibits.

## 2. One source of truth

- The calculator now lives in **`packages/calc/src/profile-completion.ts`**
  (snake_case row input = the stored columns; zero dependencies) — the only
  implementation in the repository (grep-verified).
- Web: `apps/web/lib/profile/completion.ts` is a re-export shim; the Profile
  and Dashboard pages pass the stored row directly. The deployment vendoring
  (`rebuild.sh`) now copies `profile-completion.ts` alongside `index.ts`.
- Mobile: the port in `apps/mobile/src/profile.ts` is **deleted**; the app
  imports from `@itg/calc/src/profile-completion`, vendored into
  `apps/mobile/vendor/itg-calc` by `apps/mobile/scripts/vendor-calc.mjs`
  (same pattern as the web deploy; wired into the APK workflow before the
  standalone install).
- Tests: the canonical suite `packages/calc/src/profile-completion.test.ts`
  carries the full matrix — A empty → 0%, B one field → 13%, C half → 50%,
  D all-but-photo → 88% (photo the sole missing item), E all + photo →
  exactly 100% + verified, F removal of any single field → drops + badge off
  (all 8 fields), G placeholder `not_provided` → missing; whitespace-only
  text → missing; the "production-shaped" stuck profile = 63% with the three
  uneditable-era fields as the exact missing set. Root suite: 752 → 759.

## 3. Mobile Profile redesign (reference: `1000042178_0_ncje.jpg`)

Structure and quality follow the reference; data is always the caller's real
stored data; colors follow the mandate text (black/blue/white system, violet
= AI only). New dependencies (SDK 58): `expo-linear-gradient`,
`react-native-svg`, `@expo/vector-icons`.

- **Physical glass**: `GradientCard` (L1/L2/L3) and `ProgressRing` added to
  `src/components.tsx` (additive; existing components untouched) — navy→blue→
  black gradients, top-edge light, bright borders, deep shadows/glow.
- **Hero (L3)**: 96px photo in a blue→cyan gradient ring with cyan glow
  (violet ring removed), 28px camera badge socketed on the photo, name with
  the blue verified check shown **only** at 100%, verified pill (blue glass)
  or completion chip otherwise, level ring (stored score band progress),
  gold level name, total XP, gradient XP bar. Badge-not-KYC copy preserved.
- **Stats row (L2)**: Total Trades / Win Rate / Profit Factor / Average R
  with gradient icon tiles — unchanged `profileStats` values and tones.
- **Trading Identity**: 2-column icon modules built only from stored data
  (Markets, Primary Strategy, Experience, Risk Profile, Preferred Sessions);
  "Trading Style" does not exist in the data model and was not invented.
  Edit pill routes to Edit Profile.
- **Achievements**: horizontal earned-only cards (gold medallion, name,
  earned date). No "View All" — no such route exists.
- **Completion panel (L2)**: 84px ring, canonical missing-hints list, or the
  verified "profile is complete" state.
- **Details** rows verbatim (admin review status kept distinct from the
  completeness badge). **Edit Profile**: glass header strip (avatar, name,
  live completion %), fields grouped in glass section cards mirroring the
  web form — every field, default, validation, and the full-form save are
  behaviour-identical.

## 4. Bottom navigation (Step 4)

The previous build used the plain system tab bar — no dock existed. It is
replaced by a custom in-flow floating glass dock (`GlassDock` in
`app/(app)/_layout.tsx`): 14px side margins, safe-area bottom padding, so
content can never underlap it. Slots [Home, Trades, Stats] **[Add]** [Goals,
Coach, Profile] with icon+label; active cyan (Coach active violet — the AI
identity). The Add button is a 54px blue→cyan gradient circle with a socket
ring, centre ≈10px above the dock's top edge — integrated elevation,
flex-centred exactly at 320/360/390/430 (static slot math recorded in the
layout file: no overflow at 320, circle fits its own slot from 390 up and
overhangs only into neighbour slack below that). All routes, guards, and
headers unchanged; the bar hides while a keyboard is up.

## 5. Gate

- Root: Vitest 759/759, Playwright 36/36, typecheck + lint clean, web build
  clean (First Load 103 kB unchanged), `security:check` 383 files.
- Mobile: `tsc --noEmit` clean; `expo export` succeeds; the Hermes bundle
  contains the redesigned Profile and the canonical calculator.
- Web deployed (unification) — see the production addendum below.
- Production verification + APK: see addendum.

## Production addendum (2026-11-01)

- **Web deployed: `dpl_HUhV5g9xn54F1Y67AiVeow3y2fQJ`** (READY, alias-verified
  as the deployment serving itg-traderos.vercel.app; 228 files, including
  the vendored `lib/calc/profile-completion.ts`).
- **Production verification cycle on test account A** (production
  `PATCH /api/mobile/profile` + web `/profile` SSR reads):
  fill every required field → HTTP 200 → page renders **100%** with the
  badge-active state; remove `country` → HTTP 200 → page renders **88%**,
  badge gone, "Add your country" hint present; restore → HTTP 200 → the
  stored row SQL-verified back to A's exact baseline (50%, the original
  four items missing). Ezat's account was not touched.
- **Web/mobile agreement**: both surfaces now execute the same canonical
  function over the same stored row (mobile bundle string-verified to
  contain it), so agreement holds by construction and is pinned by the
  canonical test matrix.
- **APK**: a new Android build is produced by the `mobile-apk.yml` workflow
  from the commit carrying this correction (the previous APK predates the
  redesign and must not be used to judge it). M2 remains open until Ezat
  verifies the new build on his phone — Profile visuals, the glass dock,
  and the Add button's rendered elevation are device-verified items.
