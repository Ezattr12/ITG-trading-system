-- ITG TraderOS — Migration 0023: account deletion requests
-- (Google Play release preparation)
--
-- The external, signed-out account-deletion request path: a
-- visitor who can no longer sign in (or never installed the
-- app) submits their account email on a public web page; the
-- request lands here and an admin processes it from gated
-- server code. In-app deletion does NOT use this table — a
-- signed-in trader deletes their own account directly after
-- password re-verification (lib/account/service.ts).
--
-- Posture: RLS is ENABLED with ZERO policies. No client —
-- anon or authenticated — can read or write this table at
-- all. Every access goes through the service role from
-- gated server code only: the public request action
-- (rate-limited, honeypotted, uniform response — the table
-- must never become an account-existence oracle) and the
-- admin processing action (requireAdmin-gated). This is
-- deliberately stricter than plan_events, which at least
-- lets a trader read their own rows; a deletion request
-- names an email address, and no trader ever needs to read
-- one back.
--
-- One pending request per email, enforced structurally by
-- the partial unique index on lower(email): a duplicate
-- submission conflicts and the writer treats the conflict
-- as success (the request already exists — same uniform
-- response either way).
--
-- processed_by is a plain uuid with NO foreign key: the
-- admin who processed a request may themselves later be
-- deleted, and their processing record must not block or
-- be destroyed by that deletion.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'web' check (source in ('web', 'admin')),
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'dismissed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid,
  note text
);

create unique index if not exists account_deletion_requests_pending_email_uidx
  on public.account_deletion_requests (lower(email))
  where status = 'pending';

-- ---------------------------------------------------------------- RLS
-- Enabled, zero policies on purpose (see header): service-role
-- access from gated server code only.
alter table public.account_deletion_requests enable row level security;
