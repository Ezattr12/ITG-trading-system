-- ITG TraderOS — Migration 0012: discipline events
-- Phase 6, spec §21–22, §30. The Phase 6 brief listed
-- `discipline_events` among the Phase 1 tables; it did not exist
-- (migration 0006 created goals, goal_progress and daily_activity
-- only), so it is created here. The data model only stores the
-- reminder state; the supportive, never-shaming copy lives in the
-- app (lib/discipline/engine.ts).
--
-- discipline_events is APPEND-ONLY like risk_events / audit_logs:
-- no client INSERT / UPDATE / DELETE policies — rows are written
-- server-side (service role) by lib/discipline/actions.ts,
-- best-effort, and never block a page from rendering. Traders read
-- their own events. One row per user / day / kind / level: the
-- engine only escalates, so a repeated render cannot spam the log.
do $$ begin
  create type discipline_event_kind as enum
    ('missed_journal', 'rule_breach');
exception when duplicate_object then null; end $$;

create table if not exists public.discipline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_date date not null,
  kind discipline_event_kind not null,
  level integer not null check (level between 1 and 3),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, event_date, kind, level)
);
create index if not exists discipline_events_user_idx on public.discipline_events (user_id, created_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.discipline_events enable row level security;

-- A trader reads their own events; an admin reads all. No client
-- insert/update/delete policies — server-written, append-only.
drop policy if exists "discipline_events_select_own" on public.discipline_events;
create policy "discipline_events_select_own" on public.discipline_events
  for select using (user_id = auth.uid() or public.is_admin());
