-- ITG TraderOS — Migration 0007: weekly and monthly reviews
-- Spec §21, §27, §39. Reviews are trader-written reflections plus
-- stored aggregates computed from real trades only — never fabricated.

create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  trades_count integer not null default 0 check (trades_count >= 0),
  total_pnl numeric(19, 6),
  win_rate_pct numeric(19, 6) check (win_rate_pct is null or (win_rate_pct between 0 and 100)),
  journal_completion_pct numeric(19, 6) check (journal_completion_pct is null or (journal_completion_pct between 0 and 100)),
  best_strategy text,
  worst_strategy text,
  main_mistake text,
  focus_next_week text,
  review_text text,
  status review_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start_date),
  check (week_end_date >= week_start_date)
);
create index if not exists weekly_reviews_user_idx on public.weekly_reviews (user_id, week_start_date desc);
drop trigger if exists set_weekly_reviews_updated_at on public.weekly_reviews;
create trigger set_weekly_reviews_updated_at
  before update on public.weekly_reviews
  for each row execute function public.set_updated_at();

create table if not exists public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,
  trades_count integer not null default 0 check (trades_count >= 0),
  total_pnl numeric(19, 6),
  win_rate_pct numeric(19, 6) check (win_rate_pct is null or (win_rate_pct between 0 and 100)),
  journal_completion_pct numeric(19, 6) check (journal_completion_pct is null or (journal_completion_pct between 0 and 100)),
  risk_discipline_pct numeric(19, 6) check (risk_discipline_pct is null or (risk_discipline_pct between 0 and 100)),
  goals_completed integer not null default 0 check (goals_completed >= 0),
  review_text text,
  status review_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);
create index if not exists monthly_reviews_user_idx on public.monthly_reviews (user_id, month desc);
drop trigger if exists set_monthly_reviews_updated_at on public.monthly_reviews;
create trigger set_monthly_reviews_updated_at
  before update on public.monthly_reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS (owner only + admin read)
alter table public.weekly_reviews enable row level security;
alter table public.monthly_reviews enable row level security;

drop policy if exists "weekly_reviews_select_own" on public.weekly_reviews;
create policy "weekly_reviews_select_own" on public.weekly_reviews
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "weekly_reviews_insert_own" on public.weekly_reviews;
create policy "weekly_reviews_insert_own" on public.weekly_reviews
  for insert with check (user_id = auth.uid());
drop policy if exists "weekly_reviews_update_own" on public.weekly_reviews;
create policy "weekly_reviews_update_own" on public.weekly_reviews
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "monthly_reviews_select_own" on public.monthly_reviews;
create policy "monthly_reviews_select_own" on public.monthly_reviews
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "monthly_reviews_insert_own" on public.monthly_reviews;
create policy "monthly_reviews_insert_own" on public.monthly_reviews
  for insert with check (user_id = auth.uid());
drop policy if exists "monthly_reviews_update_own" on public.monthly_reviews;
create policy "monthly_reviews_update_own" on public.monthly_reviews
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
