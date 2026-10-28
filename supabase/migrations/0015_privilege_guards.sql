-- ITG TraderOS — Migration 0015: privilege guards (security hardening)
-- Phase 11, spec §5, §43. Forward-only; never edit after merge.
--
-- Two privilege-escalation gaps found by the Phase 11 RLS audit:
--
-- 1. The profiles RLS policies let any authenticated user UPDATE
--    their own row — including the `role` and `verification_status`
--    columns — and INSERT a row with any role. Postgres RLS has no
--    column-level policies, so a trader calling the Supabase API
--    directly (bypassing the app's Server Actions) could promote
--    themselves to admin or mark themselves verified.
-- 2. The verification_records INSERT policy only checks
--    `user_id = auth.uid()`, so a trader could insert a row with
--    status 'verified'. Only the UPDATE policy was admin-restricted.
--
-- Fix: BEFORE INSERT OR UPDATE triggers that reject changes to the
-- privileged columns unless the caller is the service role (used
-- by the audit-logged admin Server Actions in lib/admin/actions.ts)
-- or an admin signed in through the client. The app never changes
-- these columns through the signed-in client: onboarding stores the
-- trader's verification claim in onboarding_profiles.answers only,
-- and profiles.verification_status is admin-set.
--
-- Also hardens public.is_admin(): a SECURITY DEFINER function runs
-- with the caller's search_path unless pinned, which is a known
-- hijack vector (an object of the same name earlier in the path
-- would resolve first). Pin search_path to public.

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.enforce_profile_privilege()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  privileged boolean := auth.role() = 'service_role' or public.is_admin();
begin
  if tg_op = 'insert' then
    if new.role is distinct from 'trader' and not privileged then
      raise exception 'role can only be set by an administrator';
    end if;
    if new.verification_status is distinct from 'not_provided' and not privileged then
      raise exception 'verification_status can only be set by an administrator';
    end if;
    return new;
  end if;
  -- update
  if new.role is distinct from old.role and not privileged then
    raise exception 'role can only be changed by an administrator';
  end if;
  if new.verification_status is distinct from old.verification_status and not privileged then
    raise exception 'verification_status can only be changed by an administrator';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_profile_privilege on public.profiles;
create trigger enforce_profile_privilege
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_privilege();

create or replace function public.enforce_verification_record_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  privileged boolean := auth.role() = 'service_role' or public.is_admin();
begin
  if tg_op = 'insert' then
    if new.status is distinct from 'not_provided' and not privileged then
      raise exception 'verification status can only be set by an administrator';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and not privileged then
    raise exception 'verification status can only be changed by an administrator';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_verification_record_status on public.verification_records;
create trigger enforce_verification_record_status
  before insert or update on public.verification_records
  for each row execute function public.enforce_verification_record_status();
