import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ProfileRow {
  id: string;
  full_name: string | null;
  father_name: string | null;
  date_of_birth: string | null;
  country: string | null;
  avatar_url: string | null;
  trading_experience: string | null;
  trading_education: string | null;
  backtesting_experience: boolean;
  backtested_trades: number;
  real_trading_experience: boolean;
  real_trades_count: number;
  demo_trading: boolean;
  employment_status: string;
  monthly_income: number | null;
  trading_capital: number | null;
  trades_real_money: boolean;
  historical_profit: number | null;
  historical_loss: number | null;
  verification_status: string;
  role: string;
}

export interface OnboardingRow {
  id: string;
  user_id: string;
  is_complete: boolean;
  current_step: number;
  answers: Record<string, unknown>;
  completed_at: string | null;
}

export interface SessionUser {
  id: string;
  email: string | null;
  profile: ProfileRow | null;
  onboarding: OnboardingRow | null;
}

/**
 * Current signed-in user + profile + onboarding, or null.
 * Returns null when Supabase is not configured (no fake session).
 * Creates the profile row on first login if signup could not
 * (e.g. email confirmation was required at signup time) — the
 * profile is the trader's own row, so RLS allows the insert.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const { data: created } = await supabase
      .from("profiles")
      .insert({ id: user.id, full_name: user.user_metadata?.full_name ?? null })
      .select("*")
      .single();
    profile = created ?? null;
  }

  const { data: onboarding } = await supabase
    .from("onboarding_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? null,
    profile: (profile as ProfileRow | null) ?? null,
    onboarding: (onboarding as OnboardingRow | null) ?? null,
  };
}

/** Require a signed-in user; returns null (caller redirects to /login). */
export async function requireUser(): Promise<SessionUser | null> {
  return getCurrentUser();
}
