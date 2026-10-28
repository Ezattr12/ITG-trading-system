-- ITG TraderOS — Migration 0002: profiles, onboarding, verification
-- Spec §6–7, §40. Missing data = "Not Provided" — never fake.
-- Sensitive financial fields (monthly_income, trading_capital) are private:
-- RLS below lets only the owner (and explicitly authorised admins, Phase 10)
-- read them; they are never exposed publicly.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  father_name text,
  date_of_birth date,
  country text,
  avatar_url text,
  trading_experience text,
  trading_education text,
  backtesting_experience boolean not null default false,
  backtested_trades integer not null default 0 check (backtested_trades >= 0),
  real_trading_experience boolean not null default false,
  real_trades_count integer not null default 0 check (real_trades_count >= 0),
  demo_trading boolean not null default false,
  employment_status employment_status not null default 'not_provided',
  monthly_income numeric(19, 2) check (monthly_income is null or monthly_income >= 0),
  trading_capital numeric(19, 2) check (trading_capital is null or trading_capital >= 0),
  trades_real_money boolean not null default false,
  historical_profit numeric(19, 2),
  historical_loss numeric(19, 2),
  verification_status verification_status not null default 'not_provided',
  role user_role not null default 'trader',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_verification_idx on public.profiles (verification_status);
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Admin helper: SECURITY DEFINER so it can read profiles.role without
-- recursing through RLS. Defined here, after profiles exists.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create table if not exists public.onboarding_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  is_complete boolean not null default false,
  current_step integer not null default 1 check (current_step >= 1),
  answers jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_profiles_user_idx on public.onboarding_profiles (user_id);
drop trigger if exists set_onboarding_profiles_updated_at on public.onboarding_profiles;
create trigger set_onboarding_profiles_updated_at
  before update on public.onboarding_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.verification_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  proof_type text not null check (proof_type in ('exchange_payout', 'statement', 'other')),
  file_path text,
  status verification_status not null default 'not_provided',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verification_records_user_idx on public.verification_records (user_id);
drop trigger if exists set_verification_records_updated_at on public.verification_records;
create trigger set_verification_records_updated_at
  before update on public.verification_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.onboarding_profiles enable row level security;
alter table public.verification_records enable row level security;

-- profiles: a trader reads/updates only their own row; creates it on signup.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- No delete policy: profiles are never deleted from the app.

-- onboarding_profiles: owner only (+ admin read).
drop policy if exists "onboarding_select_own" on public.onboarding_profiles;
create policy "onboarding_select_own" on public.onboarding_profiles
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "onboarding_insert_own" on public.onboarding_profiles;
create policy "onboarding_insert_own" on public.onboarding_profiles
  for insert with check (user_id = auth.uid());
drop policy if exists "onboarding_update_own" on public.onboarding_profiles;
create policy "onboarding_update_own" on public.onboarding_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- verification_records: owner can insert/read own; admin can read/update (review).
drop policy if exists "verification_select_own" on public.verification_records;
create policy "verification_select_own" on public.verification_records
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "verification_insert_own" on public.verification_records;
create policy "verification_insert_own" on public.verification_records
  for insert with check (user_id = auth.uid());
drop policy if exists "verification_update_admin" on public.verification_records;
create policy "verification_update_admin" on public.verification_records
  for update using (public.is_admin()) with check (public.is_admin());
