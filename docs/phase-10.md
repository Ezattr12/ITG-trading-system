# Phase 10 — Admin Panel

Status: implemented locally, tested. **Supabase project
ITG-trading-system exists** (per the parent agent's brief) but
migrations have NOT been applied to it and its keys are NOT in
the app env yet — the pages are real and complete, but they show
honest empty states until migrations are applied and env vars are
set. No demo users, trades, P&L or certificates. Vercel is
connected (per the parent agent's brief); nothing is deployed
yet (deployment is Phase 13). Not committed to GitHub (GitHub
App push still fails 403 — parent agent's blocker, unchanged).
No external AI/LLM service is connected.

## Spec covered

- §10, §40–42 Admin panel: admin dashboard, user management,
  level/verification management, achievements management,
  certificates management, goals/notifications/discipline/
  risk-rules overview (as real counts on the dashboard),
  AI config, system settings, full audit logs.

## Access control

- Admin routes live under `/admin` with a layout gate
  (`app/admin/layout.tsx`): only a signed-in user whose
  `profiles.role` is `admin` gets in. A non-admin (including
  an `auditor`, who has no admin access — see the note below)
  sees a clear "not authorised" page — never a redirect loop,
  and never any admin data, because the child pages are not
  rendered at all when the gate fails.
- The role field already existed (`profiles.role`, enum
  `user_role` = trader/admin/auditor, default `trader`,
  migration 0002) with the `public.is_admin()` SECURITY DEFINER
  helper — no role migration was needed. RLS enforces the same
  rule in the database (admin-select policies on profiles,
  certificates, audit_logs, goals, risk_rules, etc.).
  NOTE (corrected in Phase 11): the `auditor` role has NO
  distinct access — `adminGate` denies auditors, and RLS
  grants them nothing. An auditor is treated exactly like a
  trader until read-only auditor access is deliberately wired
  in a later phase.
- The header shows an Admin link only to admins.
- An admin cannot remove their own admin role (pure check in
  `lib/admin/access.ts`, tested) — the platform cannot be left
  with no admin and no way back.

## Privacy — financial data

- The admin user list selects ONLY non-financial summary fields
  (`ADMIN_USER_PUBLIC_FIELDS`: id, name, country, experience,
  verification, role, joined). `sanitizeAdminUserSummary`
  strips every financial/private field even if a caller passes
  a full profile row — tested.
- Trading capital, monthly income and historical P&L are shown
  ONLY on a trader's detail page, ONLY after the admin submits
  the financial-view form with a reason. That action writes an
  `admin.financial_view` audit row first and returns no financial
  data itself; the page then checks the audit log
  (`hasRecentFinancialAccess`, 15-minute window) before showing
  the fields, so a bookmarked URL alone reveals nothing.
- No P&L or capital totals appear anywhere on the admin
  dashboard.

## Audit logs

- Every admin action writes an `audit_logs` row with the ADMIN
  as `actor_id`, the affected trader as `user_id`, the action,
  entity and reason (`writeAdminAuditLog` in `lib/admin/audit.ts`
  — separate from `writeAuditLog` in Phase 2, which records a
  user acting on themselves and cannot express "admin X did Y
  to trader Z"). Action names are centralised in
  `ADMIN_AUDIT_ACTIONS`: role_change, verification_change,
  certificate_revoke, achievement_change, level_change,
  setting_change, financial_view.
- A failed audit write is reported as a failure — an admin
  change with no audit trail is never presented as done.
- `/admin/audit` lists the append-only log (migration 0010: no
  update/delete policies).

## What an admin can do

| Page | Actions |
|---|---|
| `/admin` | Real counts: traders, admins, trades, certificates issued/revoked, active goals, open risk events, unread notifications, discipline events (7d), AI insights (7d); recent admin activity |
| `/admin/users` | List (non-financial only) |
| `/admin/users/[id]` | Role change, verification change, financial view (reason + 15 min), level, trade/certificate/goal counts |
| `/admin/certificates` | List all certificates; revoke (reason required; only issued ones; record kept, status → revoked) |
| `/admin/achievements` | Create / edit achievements (name, slug, category, XP) without a code change |
| `/admin/levels` | Edit Bronze/Silver/Gold/Platinum score thresholds |
| `/admin/settings` | registration_open, maintenance_mode, ai_coach_mode |
| `/admin/audit` | Full audit log |

## AI config — honestly "not connected"

- The settings page states the coach is deterministic
  (rule-based, real stored data only — Phase 9) and that NO
  external LLM is connected and no API key is stored.
- `llm_connected` is a seeded setting but NOT an editable key,
  and `ai_coach_mode` only accepts `"deterministic"` (Zod
  refine, tested). No admin setting can claim an LLM is
  connected until a later phase wires a real provider.

## Migration

- `0014_system_settings.sql`: new `system_settings` table
  (key/value jsonb, admin-only RLS) with seeded defaults
  (`ai_coach_mode` = "deterministic", `llm_connected` = false,
  `registration_open` = true, `maintenance_mode` = false).
  32 tables total (was 31). No old migration was edited.

## Implementation

- `apps/web/lib/admin/`: `types.ts` (summary/financial split,
  stats, audit, settings rows), `access.ts` (pure: gate,
  self-demotion guard, sanitiser, 15-minute financial window),
  `validation.ts` (Zod for every action), `audit.ts`
  (injectable audit writer), `queries.ts` (RLS-enforced reads,
  signed-in client only), `actions.ts` (Server Actions:
  Zod → service-role write → audit → revalidate), 3 test files.
- `apps/web/app/admin/`: layout (gate + nav), dashboard,
  users, users/[id], certificates, achievements, levels,
  audit, settings.
- `apps/web/components/admin/admin-forms.tsx`: role,
  verification, revoke, financial-view, achievement, level
  and setting forms (all built on the existing `ActionForm`).
- Header gains an Admin link for admins only.

## Tests

- 271/271 Vitest tests pass (252 before + 19 new: access
  control for admin/trader/auditor/signed-out, self-demotion
  guard, financial-field stripping, financial-view window and
  wrong-admin/wrong-trader/expired cases, audit rows for role
  change / revoke / financial view with actor vs target,
  audit-write failure, validation for revoke-without-reason,
  financial-view-without-reason, achievement slug/XP,
  level thresholds incl. open-ended max, and the
  LLM-connected rejection).
- `npm run typecheck` pass, `npm run lint` pass,
  `npm run build` pass — 30 routes now (was 23); admin pages
  107–118 kB first load.

## Known limits

- Admin writes use the service-role client because RLS
  deliberately blocks client writes to profiles, certificates
  and audit_logs; reads always use the signed-in client so
  RLS still enforces the boundary.
- The dashboard overview counts goals, notifications,
  discipline and risk events; per-trader goal/notification
  detail is not a separate admin page yet — it is reachable
  from the trader's own pages and the counts here.
- Admin actions are untested against a live database —
  migrations are not applied to the real Supabase project yet
  (parent agent's Phase 13 work).
