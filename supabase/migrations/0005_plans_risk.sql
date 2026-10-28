-- ITG TraderOS — Migration 0005: trading plans, risk rules, sessions
-- Spec §19–20. The risk engine warns; it NEVER auto-executes or closes
-- real trades (spec §41).

create table if not exists public.trading_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'My Trading Plan',
  markets text[] not null default '{}',
  sessions trading_session[] not null default '{}',
  risk_per_trade_pct numeric(19, 6) check (risk_per_trade_pct is null or risk_per_trade_pct > 0),
  max_daily_loss numeric(19, 6) check (max_daily_loss is null or max_daily_loss >= 0),
  max_daily_trades integer check (max_daily_trades is null or max_daily_trades > 0),
  preferred_setup_ids uuid[] not null default '{}',
  no_trade_conditions text,
  psychology_rules text,
  schedule jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trading_plans_user_idx on public.trading_plans (user_id);
drop trigger if exists set_trading_plans_updated_at on public.trading_plans;
create trigger set_trading_plans_updated_at
  before update on public.trading_plans
  for each row execute function public.set_updated_at();

create table if not exists public.risk_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.trading_plans (id) on delete set null,
  max_risk_per_trade_pct numeric(19, 6) check (max_risk_per_trade_pct is null or max_risk_per_trade_pct > 0),
  max_daily_loss numeric(19, 6) check (max_daily_loss is null or max_daily_loss >= 0),
  max_trades_per_day integer check (max_trades_per_day is null or max_trades_per_day > 0),
  max_consecutive_losses integer check (max_consecutive_losses is null or max_consecutive_losses > 0),
  max_leverage numeric(19, 6) check (max_leverage is null or max_leverage >= 1),
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists risk_rules_user_idx on public.risk_rules (user_id);
drop trigger if exists set_risk_rules_updated_at on public.risk_rules;
create trigger set_risk_rules_updated_at
  before update on public.risk_rules
  for each row execute function public.set_updated_at();

create table if not exists public.trading_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  session trading_session not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  trades_count integer not null default 0 check (trades_count >= 0),
  pnl numeric(19, 6),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists trading_sessions_user_idx on public.trading_sessions (user_id, started_at desc);
drop trigger if exists set_trading_sessions_updated_at on public.trading_sessions;
create trigger set_trading_sessions_updated_at
  before update on public.trading_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS (owner only + admin read)
alter table public.trading_plans enable row level security;
alter table public.risk_rules enable row level security;
alter table public.trading_sessions enable row level security;

drop policy if exists "plans_select_own" on public.trading_plans;
create policy "plans_select_own" on public.trading_plans
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "plans_insert_own" on public.trading_plans;
create policy "plans_insert_own" on public.trading_plans
  for insert with check (user_id = auth.uid());
drop policy if exists "plans_update_own" on public.trading_plans;
create policy "plans_update_own" on public.trading_plans
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "risk_rules_select_own" on public.risk_rules;
create policy "risk_rules_select_own" on public.risk_rules
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "risk_rules_insert_own" on public.risk_rules;
create policy "risk_rules_insert_own" on public.risk_rules
  for insert with check (user_id = auth.uid());
drop policy if exists "risk_rules_update_own" on public.risk_rules;
create policy "risk_rules_update_own" on public.risk_rules
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "sessions_select_own" on public.trading_sessions;
create policy "sessions_select_own" on public.trading_sessions
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "sessions_insert_own" on public.trading_sessions;
create policy "sessions_insert_own" on public.trading_sessions
  for insert with check (user_id = auth.uid());
drop policy if exists "sessions_update_own" on public.trading_sessions;
create policy "sessions_update_own" on public.trading_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
