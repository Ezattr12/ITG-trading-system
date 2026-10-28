-- ITG TraderOS — Migration 0011: risk events
-- Phase 5, spec §19. The brief for Phase 5 assumed a `risk_events`
-- table existed from Phase 1; it did not (migration 0005 only
-- created trading_plans, risk_rules and trading_sessions), so it
-- is created here. Breaches are logged, never silently ignored,
-- and the engine NEVER auto-executes or closes real trades (§41).
--
-- risk_events is APPEND-ONLY like audit_logs: no client INSERT /
-- UPDATE / DELETE policies — rows are written server-side (service
-- role) by lib/risk/actions.ts, best-effort, and never block a
-- trade from being journaled. Traders read their own events.

do $$ begin
  create type risk_event_type as enum
    ('daily_loss_limit', 'daily_trade_limit', 'consecutive_losses',
     'leverage_limit', 'risk_per_trade', 'positive_streak');
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_event_severity as enum ('warning', 'critical', 'positive');
exception when duplicate_object then null; end $$;

create table if not exists public.risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.trading_plans (id) on delete set null,
  risk_rule_id uuid references public.risk_rules (id) on delete set null,
  trade_id uuid references public.trades (id) on delete set null,
  type risk_event_type not null,
  severity risk_event_severity not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists risk_events_user_idx on public.risk_events (user_id, created_at desc);
create index if not exists risk_events_type_idx on public.risk_events (user_id, type);

-- ---------------------------------------------------------------- RLS
alter table public.risk_events enable row level security;

-- A trader reads their own events; an admin reads all. No client
-- insert/update/delete policies — server-written, append-only.
drop policy if exists "risk_events_select_own" on public.risk_events;
create policy "risk_events_select_own" on public.risk_events
  for select using (user_id = auth.uid() or public.is_admin());
