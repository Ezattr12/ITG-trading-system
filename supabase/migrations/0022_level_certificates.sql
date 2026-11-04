-- ITG TraderOS — Migration 0022: level certificates (Task 24)
--
-- Certificates gain a second kind. Until now a certificate was
-- only ever the monthly Performance Certificate (migration
-- 0009): one row per (user, month), `month` NOT NULL, the
-- month's criteria evidence in `criteria_met`.
--
-- Task 23 built the Level Assessment Engine: the durable
-- evidence that a trader MET a band's standard is an append-only
-- `level_assessments` row with verdict = 'pass'. A LEVEL
-- certificate certifies exactly that historical fact — the
-- trader WAS assessed at a band on the assessment date — and
-- never a claim about their current standing (their score and
-- latest assessment may have moved since; the certificate, like
-- the monthly one for its month, stays true of its moment).
--
-- The certificates table is EXTENDED, not replaced, so the
-- monthly flow is untouched:
-- - `kind` distinguishes the two kinds; every existing row is
--   'monthly' by default.
-- - `month` drops NOT NULL: a level certificate has no month.
--   Monthly rows always carry one, so the existing
--   unique (user_id, month) constraint still enforces one
--   monthly certificate per user per month exactly as before
--   (NULL months are distinct under the constraint, which is
--   what lets a trader hold several level certificates).
-- - The evidence columns snapshot the pass at issuance:
--   `assessment_id` references the level_assessments row (the
--   evidence ref), and slug / name / assessed_at / score are
--   copied onto the certificate so verification renders from
--   the certificate row alone and never depends on mutable
--   state (band names are admin-editable; assessment history
--   is the trader's record, not the certificate's).
-- - Issuance idempotency is enforced by a partial unique index
--   on (user_id, assessment_id): one certificate per pass
--   assessment, so re-issuing returns the existing certificate
--   instead of duplicating (the level analogue of the monthly
--   (user_id, month) rule).
--
-- RLS is unchanged: certificates stay select-own-or-admin with
-- no client write policies (server-issued via the service
-- role), and no new table is created — the public verification
-- page reads through the service role server-side and exposes
-- only the certificate's own public facts.

do $$ begin
  create type certificate_kind as enum ('monthly', 'level');
exception when duplicate_object then null; end $$;

alter table public.certificates
  add column if not exists kind certificate_kind not null default 'monthly';

alter table public.certificates
  alter column month drop not null;

alter table public.certificates
  add column if not exists assessment_id uuid
    references public.level_assessments (id) on delete set null,
  add column if not exists level_slug text,
  add column if not exists level_name text,
  add column if not exists assessed_at timestamptz,
  add column if not exists assessment_score numeric(19, 6);

create unique index if not exists certificates_user_assessment_uidx
  on public.certificates (user_id, assessment_id)
  where assessment_id is not null;
