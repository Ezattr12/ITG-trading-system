-- ITG TraderOS — Migration 0006: goals, goal progress, daily activity
-- Spec §21–22. Progress is shown as current/target, e.g. 12/15 = 80%.
-- Discipline reminders are supportive, never shaming (enforced in app
-- copy; the data model only stores the reminder state).

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  period goal_period not null,
  goal_type goal_type not null default 'other',
  target_value numeric(19, 6) not null check (target_value > 0),
  target_unit text,
  start_date date not null,
  end_date date,
  status goal_status not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists goals_user_idx on public.goals (user_id, period, status);
drop trigger if exists set_goals_updated_at on public.goals;
create trigger set_goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

create table if not exists public.goal_progress (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  current_value numeric(19, 6) not null default 0 check (current_value >= 0),
  recorded_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (goal_id, recorded_date)
);
create index if not exists goal_progress_goal_idx on public.goal_progress (goal_id, recorded_date desc);
drop trigger if exists set_goal_progress_updated_at on public.goal_progress;
create trigger set_goal_progress_updated_at
  before update on public.goal_progress
  for each row execute function public.set_updated_at();

create table if not exists public.daily_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  activity_date date not null,
  journal_completed boolean not null default false,
  study_hours numeric(19, 6) not null default 0 check (study_hours >= 0),
  backtesting_sessions integer not null default 0 check (backtesting_sessions >= 0),
  trading_sessions_count integer not null default 0 check (trading_sessions_count >= 0),
  discipline_reminder_level integer not null default 0 check (discipline_reminder_level between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, activity_date)
);
create index if not exists daily_activity_user_idx on public.daily_activity (user_id, activity_date desc);
drop trigger if exists set_daily_activity_updated_at on public.daily_activity;
create trigger set_daily_activity_updated_at
  before update on public.daily_activity
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS (owner only + admin read)
alter table public.goals enable row level security;
alter table public.goal_progress enable row level security;
alter table public.daily_activity enable row level security;

drop policy if exists "goals_select_own" on public.goals;
create policy "goals_select_own" on public.goals
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "goals_insert_own" on public.goals;
create policy "goals_insert_own" on public.goals
  for insert with check (user_id = auth.uid());
drop policy if exists "goals_update_own" on public.goals;
create policy "goals_update_own" on public.goals
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "goal_progress_select_own" on public.goal_progress;
create policy "goal_progress_select_own" on public.goal_progress
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "goal_progress_insert_own" on public.goal_progress;
create policy "goal_progress_insert_own" on public.goal_progress
  for insert with check (user_id = auth.uid());
drop policy if exists "goal_progress_update_own" on public.goal_progress;
create policy "goal_progress_update_own" on public.goal_progress
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "daily_activity_select_own" on public.daily_activity;
create policy "daily_activity_select_own" on public.daily_activity
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "daily_activity_insert_own" on public.daily_activity;
create policy "daily_activity_insert_own" on public.daily_activity
  for insert with check (user_id = auth.uid());
drop policy if exists "daily_activity_update_own" on public.daily_activity;
create policy "daily_activity_update_own" on public.daily_activity
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
