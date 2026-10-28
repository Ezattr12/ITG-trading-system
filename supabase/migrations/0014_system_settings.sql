-- ITG TraderOS — Migration 0014: system settings (admin panel)
-- Phase 10, spec §10, §40–42. `system_settings` did not exist in
-- migrations 0001–0013; every other table Phase 10 needs already
-- exists (profiles with role user_role + is_admin() in 0002,
-- audit_logs in 0010, levels/achievements/user_levels in 0008,
-- certificates in 0009, goals/notifications/risk_rules in 0005–0006).
--
-- system_settings is a key/value store for admin-editable platform
-- configuration. Values are jsonb so a setting can be a boolean,
-- number or object. Defaults are inserted here (config, not demo
-- data): the AI Coach runs in deterministic mode and NO external
-- LLM is connected — an admin setting must never be able to claim
-- otherwise without a real provider being wired in a later phase.
-- No old migration was edited.

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  description text,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_system_settings_updated_at on public.system_settings;
create trigger set_system_settings_updated_at
  before update on public.system_settings
  for each row execute function public.set_updated_at();

insert into public.system_settings (key, value, description) values
  ('ai_coach_mode', '"deterministic"'::jsonb, 'AI Coach mode: deterministic (rule-based, real stored data only). No external LLM is connected.'),
  ('llm_connected', 'false'::jsonb, 'Whether an external LLM provider is connected to the AI Coach. False until a later phase wires a real provider.'),
  ('registration_open', 'true'::jsonb, 'Whether new trader registrations are accepted.'),
  ('maintenance_mode', 'false'::jsonb, 'When true, the app shows a maintenance notice to non-admin users.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- RLS
alter table public.system_settings enable row level security;

-- Admin only, read and write. Traders cannot read platform settings
-- (they may contain operational config) and cannot write them.
drop policy if exists "system_settings_admin_only" on public.system_settings;
create policy "system_settings_admin_only" on public.system_settings
  for all using (public.is_admin()) with check (public.is_admin());
