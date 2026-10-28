-- ITG TraderOS — Migration 0009: certificates, reports, AI insights, motivation
-- Spec §23, §26–27, §39. Certificates are issued only when monthly
-- requirements are met; certificate_id is unique. AI insights store
-- aggregates computed from the trader's REAL stored data only —
-- ai_insights.metrics_snapshot is the evidence, never fabricated stats.

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  certificate_id text not null unique,
  month date not null,
  criteria_met jsonb not null default '{}'::jsonb,
  pdf_path text,
  status certificate_status not null default 'pending',
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);
create index if not exists certificates_user_idx on public.certificates (user_id, month desc);
drop trigger if exists set_certificates_updated_at on public.certificates;
create trigger set_certificates_updated_at
  before update on public.certificates
  for each row execute function public.set_updated_at();

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_type report_type not null,
  period_start date not null,
  period_end date not null,
  file_path text,
  status report_status not null default 'pending',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists report_runs_user_idx on public.report_runs (user_id, created_at desc);
drop trigger if exists set_report_runs_updated_at on public.report_runs;
create trigger set_report_runs_updated_at
  before update on public.report_runs
  for each row execute function public.set_updated_at();

create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  insight_type ai_insight_type not null,
  period_start date,
  period_end date,
  summary text not null,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists ai_insights_user_idx on public.ai_insights (user_id, generated_at desc);

create table if not exists public.motivation_messages (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  context text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_motivation_messages_updated_at on public.motivation_messages;
create trigger set_motivation_messages_updated_at
  before update on public.motivation_messages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.certificates enable row level security;
alter table public.report_runs enable row level security;
alter table public.ai_insights enable row level security;
alter table public.motivation_messages enable row level security;

-- certificates / report_runs / ai_insights: owner read (+ admin read).
-- Issued server-side (Edge Functions, Phases 8–9), so no client writes.
drop policy if exists "certificates_select_own" on public.certificates;
create policy "certificates_select_own" on public.certificates
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "report_runs_select_own" on public.report_runs;
create policy "report_runs_select_own" on public.report_runs
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "ai_insights_select_own" on public.ai_insights;
create policy "ai_insights_select_own" on public.ai_insights
  for select using (user_id = auth.uid() or public.is_admin());

-- motivation_messages: readable by all authenticated users; admin writes.
drop policy if exists "motivation_select_all" on public.motivation_messages;
create policy "motivation_select_all" on public.motivation_messages
  for select using (auth.role() = 'authenticated');
drop policy if exists "motivation_write_admin" on public.motivation_messages;
create policy "motivation_write_admin" on public.motivation_messages
  for all using (public.is_admin()) with check (public.is_admin());
