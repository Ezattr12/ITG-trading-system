-- ITG TraderOS — Migration 0021: level assessments (Task 23)
--
-- The Level Assessment Engine: a durable, auditable judgement
-- that a trader MET a band's standard at a time, on evidence —
-- as opposed to the displayed level, which follows the score
-- alone and lives in the single upserted `user_levels` row
-- (no history, no reproducibility snapshot, Task 5 §2.5).
--
-- An assessment additionally requires, beyond the score
-- landing in the band:
-- - BREADTH: a minimum number of measured dimensions (the
--   weighted score renormalises over measured dimensions, so
--   without a breadth gate a trader measured on ONE dimension
--   at 100 would display — and be assessed into — the top
--   band).
-- - FLOORS: every measured dimension at or above the band's
--   floor, so dimensions cannot compensate for a collapsed
--   one (Task 5 §2.4).
-- - CONFIRMATION: the standard still met at a later
--   assessment after the band's confirmation period, so a
--   first crossing is distinguished from a sustained level.
-- Anything else is a "hold", and the stored conditions name
-- exactly which requirements were unmet.
--
-- level_assessments is APPEND-ONLY like plan_events /
-- risk_events / audit_logs: no client INSERT / UPDATE /
-- DELETE policies — rows are written server-side (service
-- role) by lib/gamification/assessment-service.ts,
-- best-effort, and never block the refresh that triggered
-- them. Traders read their own assessments; an admin reads
-- all (the plan_events policy shape, verbatim).
--
-- Each row is a REPRODUCIBILITY SNAPSHOT: dimension values,
-- the measured/missing sets, the weights and band thresholds
-- in force, the gate standard applied, the per-condition
-- outcomes with reasons, evidence references (the population
-- the score was computed from — the XP ledger's source_ref
-- idea, generalised), the rule version, and the state
-- signature the writer dedupes on. Re-running the engine on
-- the snapshot reproduces the verdict.
--
-- The gate standards themselves live in the levels'
-- scoring_config (the canonical config read from the lowest
-- level row, exactly like the weights): the second statement
-- below stamps the SAME `assessment.bands` block onto every
-- level row, so the one-distinct-config invariant Task 22
-- verified still holds. The values are the engine's
-- band-derived defaults (lib/gamification/assessment.ts,
-- defaultGateForBand) — the config makes them visible and
-- governable; it does not invent different ones.

do $$ begin
  create type assessment_verdict as enum ('pass', 'hold');
exception when duplicate_object then null; end $$;

create table if not exists public.level_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The band assessed: id + slug + name snapshotted, because
  -- the levels table is admin-editable and a rename or
  -- re-threshold must never rewrite assessment history. The
  -- slug is the durable identifier (Task 22 hand-off).
  level_id uuid references public.levels (id) on delete set null,
  level_slug text not null,
  level_name text not null,
  -- The score and the band thresholds in force at assessment
  -- time, snapshotted for the same reason.
  score numeric(19, 6) not null,
  band_min_score numeric(19, 6) not null,
  band_max_score numeric(19, 6),
  -- { dimension_key: value | null } for all eight dimensions.
  dimension_values jsonb not null default '{}'::jsonb,
  measured_dimensions text[] not null default '{}',
  missing_dimensions text[] not null default '{}',
  -- The dimension weights in force (pre-renormalisation).
  weights jsonb not null default '{}'::jsonb,
  -- The gate standard applied:
  -- { floor, min_measured, confirm_after_days }.
  gates jsonb not null default '{}'::jsonb,
  -- [{ key, label, passed, detail }] — the WHY of the verdict,
  -- in plain language, derived from this snapshot alone.
  conditions jsonb not null default '[]'::jsonb,
  -- The population the score was computed from:
  -- { closed_trades, latest_closed_at, goals, goals_completed }.
  evidence jsonb not null default '{}'::jsonb,
  -- Breadth + floors passed (confirmation aside). The next
  -- assessment's confirmation rule reads this, so it is a
  -- column, not something re-derived from the conditions.
  standard_met boolean not null default false,
  verdict assessment_verdict not null,
  rule_version integer not null,
  -- The dedupe signature: a new row exists only when the
  -- evaluated state materially changed (see the service).
  state_signature text not null,
  created_at timestamptz not null default now()
);
create index if not exists level_assessments_user_idx
  on public.level_assessments (user_id, created_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.level_assessments enable row level security;

-- A trader reads their own assessments; an admin reads all.
-- No client insert/update/delete policies — server-written,
-- append-only.
drop policy if exists "level_assessments_select_own" on public.level_assessments;
create policy "level_assessments_select_own" on public.level_assessments
  for select using (user_id = auth.uid() or public.is_admin());

-- ------------------------------------------------- gate standards
-- Stamp the assessment standards into every level row's
-- scoring_config (canonical config, identical on all rows —
-- the weights convention). Idempotent: re-running replaces
-- the assessment block with the same values and leaves the
-- weights untouched.
update public.levels
set scoring_config = coalesce(scoring_config, '{}'::jsonb) || '{
  "assessment": {
    "bands": {
      "foundation":               { "floor": null, "min_measured": 3, "confirm_after_days": 7 },
      "technical-trader":         { "floor": null, "min_measured": 3, "confirm_after_days": 7 },
      "risk-manager":             { "floor": 20, "min_measured": 4, "confirm_after_days": 7 },
      "strategy-operator":        { "floor": 20, "min_measured": 4, "confirm_after_days": 7 },
      "psychological-discipline": { "floor": 30, "min_measured": 5, "confirm_after_days": 7 },
      "consistency":              { "floor": 30, "min_measured": 5, "confirm_after_days": 7 },
      "professional-trader":      { "floor": 40, "min_measured": 6, "confirm_after_days": 28 },
      "institutional-trader":     { "floor": 50, "min_measured": 7, "confirm_after_days": 28 },
      "trading-researcher":       { "floor": 55, "min_measured": 8, "confirm_after_days": 28 },
      "itg-master-trader":        { "floor": 60, "min_measured": 8, "confirm_after_days": 28 }
    }
  }
}'::jsonb;
