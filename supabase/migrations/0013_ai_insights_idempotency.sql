-- ITG TraderOS — Migration 0013: AI Coach insight idempotency
-- Phase 9, spec §28, §39. No new table: `ai_insights` already
-- exists from migration 0009.
--
-- A refresh of the weekly coach analysis must not store the same
-- insight twice when the underlying data has not changed. The
-- unique index below makes (user, type, period, exact evidence)
-- unique at the database level: re-running the refresh with
-- unchanged data inserts nothing; when the data changes, the
-- metrics_snapshot changes too, so a new row for the same week
-- and rule is allowed. `metrics_snapshot` is jsonb, and Postgres
-- unique indexes compare jsonb by value, so key order does not
-- matter. The application also checks before inserting, so the
-- index is a backstop, not the only guard.

create unique index if not exists ai_insights_no_duplicate_idx
  on public.ai_insights (user_id, insight_type, period_start, period_end, metrics_snapshot);
