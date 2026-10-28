-- ============================================================================
-- ITG TraderOS — DEV-ONLY, OPT-IN SEED
-- ============================================================================
-- DO NOT RUN THIS IN PRODUCTION. Production starts EMPTY: no demo trades,
-- no fake P&L, no mock dashboard data. Traders see honest empty states
-- until they enter real trades.
--
-- This file contains ONLY system configuration data (no user, no trade,
-- no P&L, no fake performance):
--   * system strategies (FVG, Order Block, …)
--   * levels (Bronze / Silver / Gold / Platinum) with scoring weights
--   * achievements catalogue
--   * motivation messages (spec §23 examples)
--
-- OPT-IN GUARD: this file refuses to run unless you explicitly opt in:
--   SET itg.seed_dev_only = 'true';
-- e.g.  psql "$DATABASE_URL" -c "SET itg.seed_dev_only = 'true'" -f supabase/seed.sql
-- or in a Supabase SQL session, run the SET statement first.
-- ============================================================================

do $$
begin
  if current_setting('itg.seed_dev_only', true) is distinct from 'true' then
    raise exception 'ITG seed is DEV-ONLY and opt-in. Run SET itg.seed_dev_only = ''true'' first. NEVER run in production.';
  end if;
end $$;

-- System strategies (spec §11). user_id NULL = system-wide, not a trader's.
-- NOTE (Phase 14): ON CONFLICT (user_id, name) does NOT work here —
-- NULL user_id values are never considered equal, so a re-run would
-- duplicate the rows. Use WHERE NOT EXISTS instead.
insert into public.strategies (user_id, name, description, is_system)
select null, v.name, v.description, true
from (values
  ('FVG', 'Fair Value Gap'),
  ('Order Block', 'Order Block'),
  ('Breaker', 'Breaker Block'),
  ('Liquidity Sweep', 'Liquidity Sweep'),
  ('MSS', 'Market Structure Shift'),
  ('BOS', 'Break of Structure'),
  ('OTE', 'Optimal Trade Entry'),
  ('SMT', 'Smart Money Technique'),
  ('Other', 'Other strategy')
) as v(name, description)
where not exists (
  select 1 from public.strategies s
  where s.user_id is null and s.name = v.name
);

-- Levels (spec §8). Score is multi-dimensional, NOT profit-only.
-- Weights: discipline .20, risk .20, journal .15, goals .15,
-- psychology .10, strategy execution .10, consistency .05, performance .05.
insert into public.levels (name, slug, min_score, max_score, scoring_config, description) values
  ('Bronze', 'bronze', 0, 39,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Starting level — building the journaling habit.'),
  ('Silver', 'silver', 40, 59,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Consistent journaling and risk discipline.'),
  ('Gold', 'gold', 60, 79,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Strong process, discipline and consistency.'),
  ('Platinum', 'platinum', 80, null,
   '{"discipline": 0.20, "risk": 0.20, "journal_consistency": 0.15, "goal_completion": 0.15, "psychology": 0.10, "strategy_execution": 0.10, "consistency": 0.05, "performance": 0.05}'::jsonb,
   'Institutional standard — process, discipline and performance together.')
on conflict (slug) do nothing;

-- Achievements catalogue (spec §25). Unlocking is computed in Phase 7.
insert into public.achievements (name, slug, description, category, criteria, xp_reward) values
  ('First Trade', 'first-trade', 'Journal your first trade.', 'trades', '{"trades_journaled": 1}'::jsonb, 10),
  ('10 Trades Journaled', 'trades-10', 'Journal 10 trades.', 'trades', '{"trades_journaled": 10}'::jsonb, 20),
  ('50 Trades Journaled', 'trades-50', 'Journal 50 trades.', 'trades', '{"trades_journaled": 50}'::jsonb, 50),
  ('100 Trades Journaled', 'trades-100', 'Journal 100 trades.', 'trades', '{"trades_journaled": 100}'::jsonb, 100),
  ('7-Day Discipline', 'discipline-7', 'Follow your routine for 7 days.', 'discipline', '{"discipline_days": 7}'::jsonb, 30),
  ('30-Day Discipline', 'discipline-30', 'Follow your routine for 30 days.', 'discipline', '{"discipline_days": 30}'::jsonb, 100),
  ('100% Weekly Journal', 'weekly-journal-100', 'Journal every trade in a week.', 'journal', '{"weekly_journal_pct": 100}'::jsonb, 30),
  ('Risk Discipline Master', 'risk-master', 'Follow your risk plan for 30 trades.', 'risk', '{"risk_disciplined_trades": 30}'::jsonb, 50),
  ('Backtesting Streak', 'backtesting-streak', 'Complete 5 backtesting sessions.', 'backtesting', '{"backtesting_sessions": 5}'::jsonb, 25),
  ('Goal Master', 'goal-master', 'Complete 10 goals.', 'goals', '{"goals_completed": 10}'::jsonb, 50),
  ('Monthly Consistency', 'monthly-consistency', 'Complete a full month of journaling and reviews.', 'consistency', '{"monthly_journal_pct": 100}'::jsonb, 50)
on conflict (slug) do nothing;

-- Motivation messages (spec §23). Context-aware library, admin-editable.
-- Phase 6 adds the contexts the discipline engine selects from:
-- missed_day (Day 1–3 reminders), goal_near, streak, discipline.
-- NOTE (Phase 14): no unique constraint on message, so ON CONFLICT
-- would not deduplicate — use WHERE NOT EXISTS instead.
insert into public.motivation_messages (message, context, is_active)
select v.message, v.context, true
from (values
  ('Consistency is built through repeated execution of your process.', 'general'),
  ('Do not chase today''s loss. Protect tomorrow''s opportunity.', 'after_loss'),
  ('Your goal is not to win every trade. Your goal is to execute your edge correctly.', 'general'),
  ('A short note on one trade today is enough to keep the habit alive.', 'missed_day'),
  ('You are close to your goal — steady execution finishes it.', 'goal_near'),
  ('Three disciplined trades in a row. That is the process working.', 'streak'),
  ('Discipline is doing the small right thing when nobody is watching.', 'discipline'),
  ('Review the trade, note the lesson, move on. That is the whole routine.', 'general')
) as v(message, context)
where not exists (
  select 1 from public.motivation_messages m where m.message = v.message
);
