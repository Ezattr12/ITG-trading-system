# ITG TraderOS — Production Verification (live)

Companion to `docs/phase-14.md` (full Phase 14 report, including the
verdict, the two bugs found and fixed, and what was not verified).
This file holds the two artefacts that need to be re-checked on every
future production verification run: the live RLS matrix and the
backup/restore procedure.

Live project (verified 2026-10-27): Supabase `ITG-trading-system`
(`pwzvthvvxyfppenmessf`, ap-northeast-1, Postgres 17.11);
https://itg-traderos.vercel.app, deployment
`dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4` (READY, production).

## Live RLS matrix — 32 tables

Method (Phase 14): two confirmed test accounts (trader A, trader B)
created for this phase, plus anonymous access. Each cell is
`HTTP status : rows returned` for `SELECT id LIMIT 5` through
PostgREST as that caller. A = trader A (owns 1 profile, 2 trades,
1 goal, 1 risk rule, 1 screenshot row, 1 psychology record,
1 lesson, 1 verification record); B = trader B (owns 1 profile,
nothing else). Anon = no token. The test accounts were deleted
afterwards; production is back to 0 users / 0 trades.

| Table | A | B | anon | Notes |
|---|---|---|---|---|
| profiles | 200:1 | 200:1 | 200:0 | Own row only; B sees only its own profile |
| onboarding_profiles | 200:0 | 200:0 | 200:0 | No rows existed |
| verification_records | 200:1 | 200:0 | 200:0 | A's `not_provided` row only |
| assets | 200:0 | 200:0 | 200:0 | No asset rows seeded |
| strategies | 200:5* | 200:5* | 200:1* | Shared config; *limit 5 applied |
| setups | 200:0 | 200:0 | 200:0 | No setup rows |
| trades | 200:2 | 200:0 | 200:0 | B sees none of A's trades |
| trade_screenshots | 200:1 | 200:0 | 200:0 | |
| psychology_records | 200:1 | 200:0 | 200:0 | |
| lessons | 200:1 | 200:0 | 200:0 | |
| trading_plans | 200:0 | 200:0 | 200:0 | No plan rows |
| risk_rules | 200:1 | 200:0 | 200:0 | |
| trading_sessions | 200:0 | 200:0 | 200:0 | No session rows |
| goals | 200:1 | 200:0 | 200:0 | |
| goal_progress | 200:1 | 200:0 | 200:0 | |
| daily_activity | 200:0 | 200:0 | 200:0 | No rows |
| weekly_reviews | 200:0 | 200:0 | 200:0 | No rows |
| monthly_reviews | 200:0 | 200:0 | 200:0 | No rows |
| levels | 200:4 | 200:4 | 200:0 | Shared config (seed) |
| achievements | 200:5* | 200:5* | 200:0 | Shared config, 11 total; *limit 5 |
| user_levels | 200:0 | 200:0 | 200:0 | Server-written only |
| user_achievements | 200:0 | 200:0 | 200:0 | Server-written only |
| xp_transactions | 200:0 | 200:0 | 200:0 | Server-written only; direct insert rejected (403) |
| certificates | 200:0 | 200:0 | 200:0 | Server-written only; none issued (no criteria met) |
| report_runs | 200:0 | 200:0 | 200:0 | Server-written only |
| ai_insights | 200:0 | 200:0 | 200:0 | Server-written only |
| motivation_messages | 200:5* | 200:5* | 200:0 | Shared config, 8 total; *limit 5 |
| notifications | 200:0 | 200:0 | 200:0 | No rows |
| audit_logs | 200:2 | 200:0 | 200:0 | A's own/actor rows (the Phase 14 test promotion + revert) |
| risk_events | 200:0 | 200:0 | 200:0 | Server-written only |
| discipline_events | 200:0 | 200:0 | 200:0 | Server-written only |
| system_settings | 400 | 400 | 400 | Non-admins are denied entirely (PostgREST 400 on a denied table); admin read verified separately (200, 4 rows) |

Additional live checks (not in the matrix):
- Trader self-promotion to admin: blocked (400, trigger 0015/0018).
- Trader self-verification: blocked (400, trigger).
- Trader inserting `verification_records` with `status='verified'`:
  blocked (400, trigger); with `status='not_provided'`: allowed (201).
- Trader cannot DELETE a trade (no delete policy; PostgREST 204
  with 0 rows affected — both trades confirmed still present).
- Trader cannot upload to another user's Storage path (400) or
  download another user's private screenshot (400); owner signed
  URL works (200).
- Admin (test promotion, audit-logged, reverted): can read
  `system_settings` and all trades.

## Backup / restore

Status (2026-10-27, Management API
`GET /v1/projects/{ref}/database/backups`):

```json
{"region": "ap-northeast-1", "walg_enabled": true, "pitr_enabled": false, "backups": [], "physical_backup_data": {}}
```

- **PITR is OFF and no backup snapshots are listed.** Plan v2 §9
  requires PITR on prod and daily backups. This is an open gap —
  enable PITR in the Supabase dashboard (Pro-plan feature; may
  affect billing) and re-run this check until `pitr_enabled` is
  `true` and a backup appears in the list.
- No restore was attempted in Phase 14 (destructive).

Restore procedure (documented, not executed):
1. Supabase dashboard → Project → Database → Backups → choose a
   point-in-time (PITR) or a listed backup → Restore. Restoring
   replaces the live database — only with Ezat's approval, and
   only after exporting a fresh copy of the current data.
2. Alternative: Management API backup/restore endpoints for the
   project, same approval rule.
3. After any restore, re-run the Phase 14 live checks (seed counts
   9/4/11/8, RLS matrix spot-checks, anon route checks) before
   telling users the site is back.
4. Deployment-level recovery: Vercel dashboard → Deployments →
   the last READY deployment → Promote to Production. Do not
   delete `~/workspace/.itg-deploy-staging/` until the GitHub
   route works (code is not in GitHub yet — push still fails 403).
