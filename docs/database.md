# ITG TraderOS — Database Schema

Postgres via Supabase. Migrations in `supabase/migrations/`, one per
logical group, applied in numeric order, forward-only, never edited after
merge. Seed data (`supabase/seed.sql`) is **demo-only — never production**.

## Conventions

- UUID primary keys (`gen_random_uuid()`), `created_at` / `updated_at`
  `timestamptz` (UTC), `updated_at` maintained by the
  `set_updated_at()` trigger in migration 0001.
- Money: `numeric(19,6)`. Quantities: `numeric(19,8)`. Never float.
- Soft delete (`deleted_at`) on user-facing master data (strategies,
  setups, goals, plans, lessons). Financial facts (`trades`,
  `xp_transactions`, `audit_logs`, snapshots) are **never deleted** —
  corrections are reversing entries.
- Enums for all fixed vocabularies (direction, emotion, market condition,
  trade reason, session, goal period/type, verification status, …).
- RLS enabled on **every** table. Default policy pattern:
  trader reads/writes only rows where `user_id = auth.uid()`
  (or `id = auth.uid()` for `profiles`); admin reads all via
  `is_admin()` (SECURITY DEFINER, reads `profiles.role`); auditor
  reads own-org rows only where a policy grants it (Phase 10 refines).
- `audit_logs` is append-only: no UPDATE/DELETE policies at all.

## Migration map

| Migration | Contents |
|---|---|
| `0001_extensions_and_enums.sql` | `pgcrypto`, all enums, `set_updated_at()`, `is_admin()` |
| `0002_profiles_onboarding.sql` | `profiles`, `onboarding_profiles`, `verification_records` |
| `0003_assets_strategies_setups.sql` | `assets`, `strategies`, `setups` |
| `0004_trades.sql` | `trades`, `trade_screenshots`, `psychology_records`, `lessons` |
| `0005_plans_risk.sql` | `trading_plans`, `risk_rules`, `trading_sessions` |
| `0006_goals_discipline.sql` | `goals`, `goal_progress`, `daily_activity` |
| `0007_reviews.sql` | `weekly_reviews`, `monthly_reviews` |
| `0008_gamification.sql` | `levels`, `achievements`, `user_levels`, `user_achievements`, `xp_transactions` |
| `0009_certificates_reports_ai.sql` | `certificates`, `report_runs`, `ai_insights`, `motivation_messages` |
| `0010_notifications_audit.sql` | `notifications`, `audit_logs` |

## Key calculated fields (trades)

`pnl`, `roi_pct`, `r_multiple`, `risk_reward`, `is_win`, `duration_seconds`
are **computed server-side** (Edge Function / server action, using
`packages/calc`) and stored on the trade row for fast analytics — the
trader never enters them. The stored values must always equal a fresh
recalculation from entry/exit/size/fees/SL/TP; Phase 3 adds a
recalculation check in tests.

## Levels (multi-dimensional, not profit-only)

`levels` rows: Bronze / Silver / Gold / Platinum with `min_score`,
`max_score` and a `scoring_config` jsonb (weights for discipline, risk,
journal consistency, goal completion, psychology, strategy execution,
consistency, performance). `user_levels` holds the trader's current
level + score snapshot; XP lives in `xp_transactions` (append-only).
Admin can edit `levels.scoring_config` — the scoring function reads it
at calculation time, it is never hard-coded in the app.

## Indexes

Every foreign key is indexed. Hot paths: `trades(user_id, opened_at)`,
`xp_transactions(user_id, created_at)`, `certificates(user_id, month)`,
`trade_screenshots(trade_id)`, `psychology_records(trade_id)`,
`lessons(trade_id)`, `audit_logs(user_id, created_at)`, GIN on
`audit_logs.details`.

## Verification

- `profiles.verification_status`: `not_provided` / `partial` / `verified`.
- `verification_records`: one row per submitted proof (exchange payout /
  statement), with status + reviewer. Missing data is displayed as
  "Not Provided" — never fabricated.
