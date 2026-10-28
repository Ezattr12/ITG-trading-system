-- ITG TraderOS — Migration 0018: fix privilege-guard TG_OP case
-- Phase 14 (production verification, 2026-10-27).
--
-- BUG FOUND LIVE: migration 0015 wrote `if tg_op = 'insert' then`.
-- In PostgreSQL, TG_OP is ALWAYS UPPERCASE ('INSERT', 'UPDATE',
-- 'DELETE'). The lowercase comparison is therefore always false, so
-- the INSERT branch of both guard functions was dead code and every
-- INSERT fell through to the UPDATE branch, where OLD is NULL and
-- `new.role IS DISTINCT FROM old.role` is always true for a
-- non-privileged caller. Result in production: NO trader could
-- insert their own profiles row (or a verification_records row) via
-- the app — the signup action's `profiles.upsert(...)` failed with
-- "role can only be changed by an administrator", silently (the
-- action does not check the upsert error), so onboarding/profile
-- creation was broken for every new trader. The Phase 13 check
-- missed it because the Management API query endpoint runs with a
-- privileged role, so the trigger's `privileged` flag was true there.
--
-- FIX: recreate both functions with `tg_op = 'INSERT'`. Forward-only;
-- migration 0015 is NOT edited. Verified live in Phase 14: trader
-- profile insert succeeds, self-promotion and self-verification are
-- still blocked.

create or replace function public.enforce_profile_privilege()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  privileged boolean := auth.role() = 'service_role' or public.is_admin();
begin
  if tg_op = 'INSERT' then
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

create or replace function public.enforce_verification_record_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  privileged boolean := auth.role() = 'service_role' or public.is_admin();
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'not_provided' and not privileged then
      raise exception 'verification status can only be set by an administrator';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and not privileged then
    raise exception 'verification status can only be set by an administrator';
  end if;
  return new;
end;
$$;
