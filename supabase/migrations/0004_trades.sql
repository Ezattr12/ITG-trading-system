-- ITG TraderOS — Migration 0004: trades, screenshots, psychology, lessons
-- Spec §9–10, §14–15. Calculated fields (pnl, roi_pct, r_multiple,
-- risk_reward, is_win, duration_seconds) are computed server-side
-- (packages/calc) and stored here for fast analytics. The trader NEVER
-- enters them. Trades are financial facts: no delete policy, no
-- in-place edit of a closed trade — corrections are reversing trades
-- (status='reversed', reversal_trade_id points at the correcting trade).

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  pair text not null,
  direction trade_direction not null,
  entry_price numeric(19, 6) not null check (entry_price > 0),
  exit_price numeric(19, 6) check (exit_price is null or exit_price > 0),
  tp numeric(19, 6) check (tp is null or tp > 0),
  sl numeric(19, 6) check (sl is null or sl > 0),
  position_size numeric(19, 8) not null check (position_size > 0),
  leverage numeric(19, 6) not null default 1 check (leverage >= 1),
  fees numeric(19, 6) not null default 0 check (fees >= 0),
  opened_at timestamptz not null,
  closed_at timestamptz,
  status trade_status not null default 'open',
  strategy_id uuid references public.strategies (id) on delete set null,
  setup_id uuid references public.setups (id) on delete set null,
  market_condition market_condition,
  trade_reason trade_reason,
  session trading_session,
  notes text,
  -- server-calculated, never user-entered
  pnl numeric(19, 6),
  roi_pct numeric(19, 6),
  r_multiple numeric(19, 6),
  risk_reward numeric(19, 6),
  is_win boolean,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  reversal_trade_id uuid references public.trades (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closed_at is null or closed_at >= opened_at),
  check (status <> 'closed' or exit_price is not null)
);
create index if not exists trades_user_opened_idx on public.trades (user_id, opened_at desc);
create index if not exists trades_user_pair_idx on public.trades (user_id, pair);
create index if not exists trades_strategy_idx on public.trades (strategy_id);
create index if not exists trades_status_idx on public.trades (user_id, status);
drop trigger if exists set_trades_updated_at on public.trades;
create trigger set_trades_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();

create table if not exists public.trade_screenshots (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  file_name text,
  ocr_status ocr_status not null default 'not_applicable',
  ocr_extracted jsonb,
  verified_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trade_screenshots_trade_idx on public.trade_screenshots (trade_id);
create index if not exists trade_screenshots_user_idx on public.trade_screenshots (user_id);
drop trigger if exists set_trade_screenshots_updated_at on public.trade_screenshots;
create trigger set_trade_screenshots_updated_at
  before update on public.trade_screenshots
  for each row execute function public.set_updated_at();

create table if not exists public.psychology_records (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid references public.trades (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  confidence integer check (confidence is null or (confidence between 1 and 5)),
  emotion emotion,
  discipline discipline_rating,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists psychology_records_trade_idx on public.psychology_records (trade_id);
create index if not exists psychology_records_user_idx on public.psychology_records (user_id, recorded_at desc);
drop trigger if exists set_psychology_records_updated_at on public.psychology_records;
create trigger set_psychology_records_updated_at
  before update on public.psychology_records
  for each row execute function public.set_updated_at();

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid references public.trades (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  text text not null,
  is_repeated_mistake boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_trade_idx on public.lessons (trade_id);
create index if not exists lessons_user_idx on public.lessons (user_id, created_at desc);
drop trigger if exists set_lessons_updated_at on public.lessons;
create trigger set_lessons_updated_at
  before update on public.lessons
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.trades enable row level security;
alter table public.trade_screenshots enable row level security;
alter table public.psychology_records enable row level security;
alter table public.lessons enable row level security;

-- trades: owner only (+ admin read). No DELETE policy — financial facts
-- are never deleted from the app; use status='reversed'.
drop policy if exists "trades_select_own" on public.trades;
create policy "trades_select_own" on public.trades
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own" on public.trades
  for insert with check (user_id = auth.uid());
drop policy if exists "trades_update_own" on public.trades;
create policy "trades_update_own" on public.trades
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "screenshots_select_own" on public.trade_screenshots;
create policy "screenshots_select_own" on public.trade_screenshots
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "screenshots_insert_own" on public.trade_screenshots;
create policy "screenshots_insert_own" on public.trade_screenshots
  for insert with check (user_id = auth.uid());
drop policy if exists "screenshots_update_own" on public.trade_screenshots;
create policy "screenshots_update_own" on public.trade_screenshots
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "screenshots_delete_own" on public.trade_screenshots;
create policy "screenshots_delete_own" on public.trade_screenshots
  for delete using (user_id = auth.uid());

drop policy if exists "psychology_select_own" on public.psychology_records;
create policy "psychology_select_own" on public.psychology_records
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "psychology_insert_own" on public.psychology_records;
create policy "psychology_insert_own" on public.psychology_records
  for insert with check (user_id = auth.uid());
drop policy if exists "psychology_update_own" on public.psychology_records;
create policy "psychology_update_own" on public.psychology_records
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "lessons_select_own" on public.lessons;
create policy "lessons_select_own" on public.lessons
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "lessons_insert_own" on public.lessons;
create policy "lessons_insert_own" on public.lessons
  for insert with check (user_id = auth.uid());
drop policy if exists "lessons_update_own" on public.lessons;
create policy "lessons_update_own" on public.lessons
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
