# ITG TraderOS mobile app — architecture & specification (Stage 6)

Status: specification only. No mobile implementation is
authorized yet; this document is written to be
implementation-ready once Ezat approves it. The mobile app
is a **client of the existing system** — same Supabase
backend, same auth, same RLS, same business logic. It must
never become a second implementation of financial
calculations.

## 1. Technology choice

**React Native + Expo (TypeScript).** Rationale:
- One language/codebase with the web app (TypeScript);
  `@itg/calc` and the validation modules are pure TS and
  can be consumed as-is (no ports, no drift).
- One build for iOS + Android; Expo's managed workflow +
  EAS Build/Submit removes native toolchain burden for a
  solo product owner.
- Supabase JS client is first-class on RN; the same
  Row-Level Security model applies unchanged.
- Alternatives rejected: Flutter (second language, calc
  re-implementation risk — violates the single-calculation
  rule); native Swift/Kotlin (two codebases, same risk);
  PWA-only (the web app already is responsive; a PWA adds
  no store presence, weaker push, weaker secure storage).

## 2. Non-negotiable reuse rules

1. **Calculations:** the app imports `@itg/calc` for every
   number it computes locally (P&L preview, R, RR, ROI).
   Server-stored metrics remain authoritative; the app
   displays stored values and never re-derives financial
   history differently.
2. **Validation:** shared zod schemas from the web app's
   lib (validation modules are framework-free) — same
   rules, same messages.
3. **Authorization:** identical to web — Supabase Auth
   session + Postgres RLS. The app holds NO service-role
   key and no elevated privilege. Anything the web RLS
   forbids stays forbidden.
4. **Writes** go through the same Postgres tables under
   RLS (or the web app's API/actions if a flow needs
   server-side side effects like XP/audit — see §4).

## 3. Authentication & secure storage

- Supabase Auth (email/password at launch parity with web;
  the same accounts work — one identity across platforms).
- Session tokens stored in **Expo SecureStore** (Keychain /
  Keystore), never AsyncStorage; auto-refresh on; biometric
  unlock gate (expo-local-authentication) before showing
  journal data after backgrounding.
- Deep-link auth callbacks (`itgtraderos://auth/callback`)
  for password reset / email confirmation, mirroring the
  web `/auth/callback` flow.
- Sign-out clears SecureStore and the local cache (§6).

## 4. API / data layer

- **Reads:** Supabase JS client directly (RLS enforces
  tenant isolation), using the same table/column contracts
  as the web queries; list fetches bounded exactly like
  web (500-trade cap pattern, paginated beyond).
- **Writes with side effects** (trade create → XP, risk
  events, audit; avatar/screenshot upload; weekly review →
  XP): these have server-side logic in web Server Actions
  today. Mobile must NOT re-implement them client-side.
  Specification: extract those actions into authenticated
  **route handlers / edge-callable endpoints** in the web
  app (`/api/...` with the caller's JWT, executing the same
  lib code, writing the same audit rows), and both web and
  mobile call them. Until that extraction is done and
  verified, mobile v1 is **read + journal-entry via the
  same endpoints only where they exist** — no parallel
  logic. This extraction is the first implementation phase
  and is itself a web-side change requiring the full
  verification suite.
- **Uploads:** Supabase Storage with the same buckets
  (`avatars` public, `trade-screenshots` private + signed
  URLs) and the same size/type rules — and the same lesson
  from the 2026-10-29 incident: client-side pre-validation
  mirroring the shared validators, server remains
  authoritative.

## 5. Navigation & scope parity

Tab bar mirroring the web mobile shell: **Home, Trades,
Add (center action), Analytics, Goals**, plus a More menu
(Profile, Risk, Plan, Psychology, Calendar, Progress,
Levels, Achievements, Certificates, Reports, Weekly
Review, AI Coach, Notifications, Admin read-only gate
unchanged). Screens are functional equivalents of the web
routes; the Phase 18/19 glass design tokens (colors, type,
spacing) carry over as the mobile theme — same product,
not a redesign.

## 6. Offline strategy

- **Read cache:** last-fetched dashboard/trades cached
  (encrypted store), clearly badged with its fetch time;
  stale data is labeled, never presented as live.
- **Writes are online-only for financial records.** A trade
  must reach the server (with its server-computed metrics,
  XP and audit) to exist. Offline trade drafts may be kept
  locally as *drafts* (clearly marked, excluded from all
  stats) and submitted when connectivity returns; a draft
  is never shown as a saved trade.
- Conflict rule: server wins; drafts carry client
  timestamps only for ordering the outbox.

## 7. Push notifications

- Expo Push Service → APNs/FCM. Triggers mirror existing
  in-app notifications (discipline reminders Day 1/2/3,
  goal milestones, weekly-review prompt, certificate
  eligibility). The notification *decisions* stay in the
  existing server engines; mobile only registers tokens
  (new table: device push tokens, RLS owner-only) and
  renders. No new notification logic client-side.

## 8. AI Coach integration

- The coach tab calls the same insights data the web shows
  (ai_insights + metrics_snapshot).
- The MCP layer (Stages 3–4) is a desktop/assistant-side
  integration; the mobile app does not embed the MCP
  server. If in-app conversational coaching is added
  later, it calls the same authenticated endpoints and the
  same snapshot rules (docs/ai-coach-foundation.md).

## 9. Release strategy

- EAS Build + EAS Submit; internal TestFlight / Play
  internal testing with the verification account first;
  staged rollout. Versioning shares the web repo's release
  notes; the app ships only after the §4 endpoint
  extraction phase passes the same production audit
  (Stage 2 checklist) against the mobile client.
- Store data-safety/privacy declarations must match
  reality: trading journal data in Supabase (region
  ap-northeast-1), no ad trackers, no data sale.

## 10. Implementation phases (when authorized)

M1: endpoint extraction in web app (no behavior change) +
full verification. M2: RN app shell, auth, read-only
screens (dashboard/trades/analytics/profile). M3: write
flows via extracted endpoints (add trade, review,
screenshots, goals, risk, plan, weekly review). M4:
offline drafts + push. M5: store submission. Each phase
ends with the Stage 2-style production audit before the
next begins.

**M1 status (2026-10-30, Phase 21): DONE** — the priority
write operations now live on a shared service layer
(`lib/trades/service.ts`, `lib/profile/service.ts`,
`lib/discipline/service.ts`) with the web actions as thin
adapters, and the following authenticated endpoints exist
(Bearer Supabase token, identity from the token only;
full contract in `docs/phase-21-m1.md`):

- `POST /api/mobile/trades`
- `POST /api/mobile/trades/[id]/review`
- `POST /api/mobile/trades/[id]/correct`
- `PATCH /api/mobile/profile`
- `POST /api/mobile/profile/avatar` (multipart, field `file`)
- `POST /api/mobile/goals`
- `POST /api/mobile/goals/[id]/progress`
- `PATCH /api/mobile/goals/[id]`

Deferred to M2 (reasons in `docs/phase-21-m1.md` §5):
risk rules/plan, weekly review, trade screenshots,
cancel-trade, notification mark-read, backtesting log.
