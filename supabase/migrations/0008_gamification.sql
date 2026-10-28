-- ITG TraderOS — Migration 0008: levels, achievements, XP
-- Spec §8, §24–25. Levels are multi-dimensional, NOT profit-only:
-- scoring_config (jsonb on levels) holds the weights for discipline,
-- risk, journal consistency, goal completion, psychology, strategy
-- execution, consistency and performance. Admin-editable, read at
-- calculation time, never hard-coded in the app.
-- XP rewards process/discipline/learning/consistency, not only profit.
-- xp_transactions is append-only: no UPDATE/DELETE policies.

create table if not exists public.levels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  min_score numeric(19, 6) not null,
  max_score numeric(19, 6),
  scoring_config jsonb not null default '{}'::jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_score is null or max_score > min_score)
);
drop trigger if exists set_levels_updated_at on public.levels;
create trigger set_levels_updated_at
  before update on public.levels
  for each row execute function public.set_updated_at();

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  category achievement_category not null default 'other',
  criteria jsonb not null default '{}'::jsonb,
  xp_reward integer not null default 0 check (xp_reward >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_achievements_updated_at on public.achievements;
create trigger set_achievements_updated_at
  before update on public.achievements
  for each row execute function public.set_updated_at();

create table if not exists public.user_levels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  level_id uuid references public.levels (id) on delete set null,
  score numeric(19, 6) not null default 0,
  score_breakdown jsonb not null default '{}'::jsonb,
  calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_levels_user_idx on public.user_levels (user_id);
drop trigger if exists set_user_levels_updated_at on public.user_levels;
create trigger set_user_levels_updated_at
  before update on public.user_levels
  for each row execute function public.set_updated_at();

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);
create index if not exists user_achievements_user_idx on public.user_achievements (user_id, unlocked_at desc);

create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null,
  reason xp_reason not null,
  source_ref_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists xp_transactions_user_idx on public.xp_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.levels enable row level security;
alter table public.achievements enable row level security;
alter table public.user_levels enable row level security;
alter table public.user_achievements enable row level security;
alter table public.xp_transactions enable row level security;

-- levels / achievements: readable by all authenticated users; admin writes.
drop policy if exists "levels_select_all" on public.levels;
create policy "levels_select_all" on public.levels
  for select using (auth.role() = 'authenticated');
drop policy if exists "levels_write_admin" on public.levels;
create policy "levels_write_admin" on public.levels
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "achievements_select_all" on public.achievements;
create policy "achievements_select_all" on public.achievements
  for select using (auth.role() = 'authenticated');
drop policy if exists "achievements_write_admin" on public.achievements;
create policy "achievements_write_admin" on public.achievements
  for all using (public.is_admin()) with check (public.is_admin());

-- user_levels / user_achievements / xp_transactions: owner read (+ admin read).
-- Writes happen server-side (Edge Function / service role) in Phases 7–9,
-- so no client INSERT/UPDATE policies are granted here.
drop policy if exists "user_levels_select_own" on public.user_levels;
create policy "user_levels_select_own" on public.user_levels
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_achievements_select_own" on public.user_achievements;
create policy "user_achievements_select_own" on public.user_achievements
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "xp_select_own" on public.xp_transactions;
create policy "xp_select_own" on public.xp_transactions
  for select using (user_id = auth.uid() or public.is_admin());
