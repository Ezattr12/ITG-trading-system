-- ITG TraderOS — Migration 0019: plan events (Task 19)
-- Trading Plan Enforcement: automatic, OBSERVATIONAL monitoring
-- of the trader's own plan. Every saved trade is evaluated
-- against the active plan (lib/plan/engine.ts); breaches are
-- logged here and notified. Plan enforcement NEVER blocks a
-- save — blocking semantics belong to the risk rules (migration
-- 0011) and to the Task 20 pre-trade gate design.
--
-- Why a new table instead of reusing risk_events: the
-- risk_events.type enum is a closed set of RISK-RULE terms tied
-- to risk_rules rows (risk_rule_id), and the Risk page reads
-- risk_events as risk history. Plan terms (market, session,
-- setup) have no honest mapping onto those values, and
-- risk_events has no dedupe keys. plan_events mirrors the
-- risk_events shape and its append-only RLS instead.
--
-- plan_events is APPEND-ONLY like risk_events / audit_logs:
-- no client INSERT / UPDATE / DELETE policies — rows are
-- written server-side (service role) by lib/plan/service.ts,
-- best-effort, and never block a trade from being journaled.
-- Traders read their own events.
--
-- Dedupe is structural, enforced by two partial unique
-- indexes (the writer also checks existence first and treats
-- a conflict as "already logged"):
-- - trade-level terms (market, session, setup,
--   risk_per_trade): one event per (user, trade, term).
-- - day-level terms (daily_trade_limit, daily_loss_limit):
--   one event per (user, day, term), attributed to the trade
--   that crossed the line.

do $$ begin
  create type plan_event_term as enum
    ('market', 'session', 'setup', 'risk_per_trade',
     'daily_trade_limit', 'daily_loss_limit');
exception when duplicate_object then null; end $$;

create table if not exists public.plan_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.trading_plans (id) on delete set null,
  trade_id uuid references public.trades (id) on delete set null,
  term plan_event_term not null,
  -- The UTC day a day-level term refers to (the trade's opened
  -- day for daily_trade_limit, its closed day for
  -- daily_loss_limit). Also stamped on trade-level events with
  -- the trade's opened day, for period summaries.
  event_day date,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists plan_events_user_idx on public.plan_events (user_id, created_at desc);
create index if not exists plan_events_term_idx on public.plan_events (user_id, term);

create unique index if not exists plan_events_trade_term_uidx
  on public.plan_events (user_id, trade_id, term)
  where term in ('market', 'session', 'setup', 'risk_per_trade');
create unique index if not exists plan_events_day_term_uidx
  on public.plan_events (user_id, event_day, term)
  where term in ('daily_trade_limit', 'daily_loss_limit');

-- ---------------------------------------------------------------- RLS
alter table public.plan_events enable row level security;

-- A trader reads their own events; an admin reads all. No client
-- insert/update/delete policies — server-written, append-only.
drop policy if exists "plan_events_select_own" on public.plan_events;
create policy "plan_events_select_own" on public.plan_events
  for select using (user_id = auth.uid() or public.is_admin());
