-- ITG TraderOS — Migration 0020: ten competency levels (Task 22)
--
-- Expands the level ladder from four bands (Bronze 0–39, Silver
-- 40–59, Gold 60–79, Platinum 80+, seeded in migration 0017) to
-- ten competency bands. The new bands are anchor-preserving
-- subdivisions of the old ones — the 40 / 60 / 80 boundaries
-- survive as band boundaries — so no trader's broad standing
-- changes meaning:
--
--   Foundation              0–19    (Bronze, lower)
--   Technical Trader       20–39    (Bronze, upper)
--   Risk Manager           40–49    (Silver, lower)
--   Strategy Operator      50–59    (Silver, upper)
--   Psychological Discipline 60–69  (Gold, lower)
--   Consistency            70–79    (Gold, upper)
--   Professional Trader    80–86    (Platinum)
--   Institutional Trader   87–92    (Platinum)
--   Trading Researcher     93–96    (Platinum)
--   ITG Master Trader      97+      (Platinum)
--
-- The titles are internal ITG bands of the one multi-dimensional
-- score; they claim no external accreditation.
--
-- How the transition is made safe:
-- 1. The four existing rows are UPDATED IN PLACE to the lower
--    subdivision of their old band. Row ids do not change, so
--    every user_levels.level_id reference stays valid.
-- 2. The remaining six bands are INSERTed with the same
--    canonical scoring_config the existing rows carry (the
--    config is global by convention: scoring reads the lowest
--    band's row).
-- 3. user_levels rows are RE-POINTED to the band that contains
--    their stored score under the new ladder, using the same
--    min-threshold resolution as the application code. Each
--    stored row is therefore self-consistent the moment the new
--    code first reads it: the previous level name it reports
--    equals the trader's current band, so the transition itself
--    fires no "level up" notification. (The application also
--    guards notifications to genuine upward crossings —
--    isGenuineLevelUp — as a second line of defence.)
--
-- Idempotent: the updates are keyed by the OLD slugs and match
-- nothing on a re-run; inserts use ON CONFLICT DO NOTHING; the
-- re-point is a pure function of the stored score.

-- 1. Rename / re-band the four existing rows in place.
update public.levels
set name = 'Foundation',
    slug = 'foundation',
    min_score = 0,
    max_score = 19,
    description = 'The starting band — building the journaling habit and basic records.'
where slug = 'bronze';

update public.levels
set name = 'Risk Manager',
    slug = 'risk-manager',
    min_score = 40,
    max_score = 49,
    description = 'Risk process forming — stop-losses and disciplined sizing becoming routine.'
where slug = 'silver';

update public.levels
set name = 'Psychological Discipline',
    slug = 'psychological-discipline',
    min_score = 60,
    max_score = 69,
    description = 'Strong process — discipline and consistency holding across dimensions.'
where slug = 'gold';

update public.levels
set name = 'Professional Trader',
    slug = 'professional-trader',
    min_score = 80,
    max_score = 86,
    description = 'Professional-standard process across every measured dimension.'
where slug = 'platinum';

-- 2. Insert the six new bands.
insert into public.levels (name, slug, min_score, max_score, scoring_config, description) values
  ('Technical Trader', 'technical-trader', 20, 39,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Developing routine — trades recorded with setups and risk notes.'),
  ('Strategy Operator', 'strategy-operator', 50, 59,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Executing a defined strategy with a steady overall process score.'),
  ('Consistency', 'consistency', 70, 79,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Consistent execution, week after week, across all measured dimensions.'),
  ('Institutional Trader', 'institutional-trader', 87, 92,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Institutional standard — process, discipline and performance together.'),
  ('Trading Researcher', 'trading-researcher', 93, 96,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Advanced band — sustained high scores across all eight dimensions.'),
  ('ITG Master Trader', 'itg-master-trader', 97, null,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'The highest ITG band — the full process score, mastered inside ITG TraderOS.')
on conflict (slug) do nothing;

-- 3. Re-point stored levels to the band containing the stored
--    score under the new ladder (greatest min_score at or below
--    the score — the application's own resolution rule).
update public.user_levels ul
set level_id = (
  select l.id
  from public.levels l
  where ul.score >= l.min_score
  order by l.min_score desc
  limit 1
)
where ul.score is not null;
