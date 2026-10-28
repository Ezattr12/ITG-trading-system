-- ITG TraderOS — Migration 0001: extensions, enums, shared functions
-- Phase 1. Forward-only; never edit after merge.

create extension if not exists "pgcrypto";

-- Shared updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- enums
do $$ begin
  create type user_role as enum ('trader', 'admin', 'auditor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_status as enum ('not_provided', 'partial', 'verified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_status as enum
    ('full_time', 'part_time', 'employed_other_job', 'unemployed', 'studying', 'not_provided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_direction as enum ('long', 'short');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_status as enum ('open', 'closed', 'cancelled', 'reversed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type market_condition as enum
    ('trending', 'ranging', 'choppy', 'high_volatility', 'low_volatility', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_reason as enum
    ('strategy', 'technical_setup', 'liquidity', 'news', 'fomo', 'revenge', 'random', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type emotion as enum ('calm', 'fear', 'greed', 'fomo', 'revenge', 'neutral');
exception when duplicate_object then null; end $$;

do $$ begin
  create type discipline_rating as enum ('good', 'average', 'poor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trading_session as enum ('asia', 'london', 'new_york', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asset_class as enum ('forex', 'crypto', 'stocks', 'indices', 'commodities', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_period as enum ('daily', 'weekly', 'monthly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_type as enum
    ('max_trades', 'journal_completion', 'study_hours', 'backtesting_sessions',
     'trading_sessions', 'risk_discipline', 'performance_target', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_status as enum ('active', 'completed', 'paused', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type xp_reason as enum
    ('trade_journal', 'daily_goal', 'backtest_session', 'weekly_review',
     'risk_discipline', 'achievement', 'penalty', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type achievement_category as enum
    ('trades', 'discipline', 'journal', 'risk', 'backtesting', 'goals', 'consistency', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type certificate_status as enum ('pending', 'issued', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum
    ('goal_reminder', 'journal_reminder', 'risk_warning', 'discipline_warning',
     'achievement', 'level_up', 'weekly_report', 'monthly_report', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_insight_type as enum
    ('weekly_performance', 'mistakes', 'best_strategy', 'worst_strategy',
     'psychology', 'risk', 'goals', 'discipline', 'focus_next_week');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ocr_status as enum ('pending', 'extracted', 'verified', 'rejected', 'not_applicable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_type as enum ('daily', 'weekly', 'monthly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_status as enum ('pending', 'generating', 'ready', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_status as enum ('draft', 'completed');
exception when duplicate_object then null; end $$;
