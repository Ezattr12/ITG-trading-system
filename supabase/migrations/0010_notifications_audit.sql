-- ITG TraderOS — Migration 0010: notifications, audit logs
-- Spec §30, §38, §5. Notifications are in-app first; the type/channel
-- model is ready for email / push / Telegram later (Phase 6–8).
-- audit_logs is APPEND-ONLY: no UPDATE or DELETE policies exist, and
-- no client INSERT policy either — rows are written server-side
-- (triggers / Edge Functions / service role) only.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text,
  is_read boolean not null default false,
  related_entity_type text,
  related_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id, is_read);
drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_details_idx on public.audit_logs using gin (details);

-- ---------------------------------------------------------------- RLS
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- notifications: owner reads + marks own as read; no client insert/delete.
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit_logs: a trader may read rows about themselves; admin reads all.
-- No insert/update/delete policies — append-only, server-written.
drop policy if exists "audit_logs_select_own" on public.audit_logs;
create policy "audit_logs_select_own" on public.audit_logs
  for select using (user_id = auth.uid() or actor_id = auth.uid() or public.is_admin());
