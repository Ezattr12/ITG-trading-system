-- ITG TraderOS — Migration 0003: assets, strategies, setups
-- Spec §11. System strategies (FVG, Order Block, …) have user_id NULL;
-- custom strategies later have user_id set. Soft-delete via deleted_at.

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text,
  asset_class asset_class not null default 'other',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (symbol, asset_class)
);
create index if not exists assets_symbol_idx on public.assets (symbol);
drop trigger if exists set_assets_updated_at on public.assets;
create trigger set_assets_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  is_system boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists strategies_user_idx on public.strategies (user_id);
drop trigger if exists set_strategies_updated_at on public.strategies;
create trigger set_strategies_updated_at
  before update on public.strategies
  for each row execute function public.set_updated_at();

create table if not exists public.setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  name text not null,
  description text,
  is_system boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists setups_user_idx on public.setups (user_id);
create index if not exists setups_strategy_idx on public.setups (strategy_id);
drop trigger if exists set_setups_updated_at on public.setups;
create trigger set_setups_updated_at
  before update on public.setups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.assets enable row level security;
alter table public.strategies enable row level security;
alter table public.setups enable row level security;

-- assets: readable by any authenticated user; writable by admin only.
drop policy if exists "assets_select_all" on public.assets;
create policy "assets_select_all" on public.assets
  for select using (auth.role() = 'authenticated');
drop policy if exists "assets_write_admin" on public.assets;
create policy "assets_write_admin" on public.assets
  for all using (public.is_admin()) with check (public.is_admin());

-- strategies / setups: system rows (user_id null) readable by all;
-- own rows readable/writable by owner; admin can manage all.
drop policy if exists "strategies_select" on public.strategies;
create policy "strategies_select" on public.strategies
  for select using (user_id is null or user_id = auth.uid() or public.is_admin());
drop policy if exists "strategies_insert_own" on public.strategies;
create policy "strategies_insert_own" on public.strategies
  for insert with check (user_id = auth.uid());
drop policy if exists "strategies_update_own" on public.strategies;
create policy "strategies_update_own" on public.strategies
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "setups_select" on public.setups;
create policy "setups_select" on public.setups
  for select using (user_id is null or user_id = auth.uid() or public.is_admin());
drop policy if exists "setups_insert_own" on public.setups;
create policy "setups_insert_own" on public.setups
  for insert with check (user_id = auth.uid());
drop policy if exists "setups_update_own" on public.setups;
create policy "setups_update_own" on public.setups
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
