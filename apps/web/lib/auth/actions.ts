"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { avatarFileError } from "@/lib/profile/avatar-validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  onboardingStepSchemas,
  ONBOARDING_PROFILE_COLUMNS,
  profileEditSchema,
  firstZodError,
  type OnboardingStep,
} from "@/lib/auth/validation";
import {
  checkRateLimit,
  AUTH_RATE_LIMIT,
  RESET_RATE_LIMIT,
} from "@/lib/auth/rate-limit";
import { updateProfileCore, uploadAvatarCore } from "@/lib/profile/service";
import { writeAuditLog } from "@/lib/auth/audit";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  redirectTo?: string;
}

function notConfigured(): ActionResult {
  return { ok: false, error: supabaseNotConnectedMessage() };
}

function toNumberOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: FormDataEntryValue | null): boolean {
  return v === "true" || v === "on" || v === "yes";
}

function toText(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/* ------------------------------------------------------------------ auth */

export async function signInAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const { email, password } = parsed.data;

  const rate = checkRateLimit(`login:${email.toLowerCase()}`, AUTH_RATE_LIMIT.limit, AUTH_RATE_LIMIT.windowMs);
  if (!rate.allowed) {
    return {
      ok: false,
      error: `Too many login attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, error: "Email or password is incorrect. Please try again." };
  }
  await writeAuditLog({ userId: data.user.id, action: "auth.login", entityType: "user", entityId: data.user.id });
  return { ok: true, redirectTo: "/dashboard" };
}

export async function signUpAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const { fullName, email, password } = parsed.data;

  const rate = checkRateLimit(`signup:${email.toLowerCase()}`, AUTH_RATE_LIMIT.limit, AUTH_RATE_LIMIT.windowMs);
  if (!rate.allowed) {
    return { ok: false, error: `Too many signup attempts. Try again in ${rate.retryAfterSeconds} seconds.` };
  }

  const supabase = await createServerSupabaseClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${appUrl}/auth/callback`,
    },
  });
  if (error || !data.user) {
    // Generic message on purpose: Supabase's message reveals whether
    // the email is already registered (account enumeration).
    return { ok: false, error: "Could not create the account. Please try again." };
  }

  // If a session was created immediately (email confirmation off),
  // create the profile + onboarding rows now. If confirmation is
  // required, there is no session yet — getCurrentUser() creates
  // the profile on first login instead. Never fake this step.
  if (data.session) {
    // Surface a failed profile setup instead of silently succeeding:
    // a hidden failure here is what masked the privilege-guard bug
    // (migration 0015) in production. The profile is re-created on
    // first login by getCurrentUser(), so the user can recover by
    // logging in again — but they must be told, not sent on as if
    // everything worked.
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({ id: data.user.id, full_name: fullName });
    const { error: onboardingError } = await supabase
      .from("onboarding_profiles")
      .upsert({ user_id: data.user.id, is_complete: false, current_step: 1, answers: { fullName } });
    if (profileError || onboardingError) {
      return {
        ok: false,
        error:
          "Account created, but your profile could not be set up. Please log in again — your profile is created when you log in.",
      };
    }
    await writeAuditLog({ userId: data.user.id, action: "auth.signup", entityType: "user", entityId: data.user.id });
    return { ok: true, redirectTo: "/onboarding" };
  }
  return {
    ok: true,
    message:
      "Account created. Check your email for a verification link, then log in — onboarding starts after that.",
  };
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.auth.signOut();
    if (user) {
      await writeAuditLog({ userId: user.id, action: "auth.logout", entityType: "user", entityId: user.id });
    }
  }
  redirect("/login");
}

export async function requestPasswordResetAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const { email } = parsed.data;
  const rate = checkRateLimit(`reset:${email.toLowerCase()}`, RESET_RATE_LIMIT.limit, RESET_RATE_LIMIT.windowMs);
  if (!rate.allowed) {
    return { ok: false, error: `Too many reset requests. Try again in ${rate.retryAfterSeconds} seconds.` };
  }
  const supabase = await createServerSupabaseClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Always return the same message whether or not the email exists:
  // never reveal which emails have an account.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
  });
  return {
    ok: true,
    message: "If an account exists for that email, a password reset link has been sent.",
  };
}

export async function resetPasswordAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: "Could not reset the password. The link may have expired — request a new one." };
  return { ok: true, redirectTo: "/login", message: "Password updated. Please log in." };
}

/* ------------------------------------------------------------- onboarding */

function stepFormValues(step: OnboardingStep, formData: FormData): Record<string, unknown> {
  switch (step) {
    case 1:
      return {
        fullName: toText(formData.get("fullName")),
        fatherName: toText(formData.get("fatherName")),
        dateOfBirth: toText(formData.get("dateOfBirth")),
        country: toText(formData.get("country")),
      };
    case 2:
      return {
        tradingExperience: toText(formData.get("tradingExperience")),
        tradingEducation: toText(formData.get("tradingEducation")),
        backtestingExperience: toBool(formData.get("backtestingExperience")),
        backtestedTrades: toNumberOrNull(formData.get("backtestedTrades")),
        realTradingExperience: toBool(formData.get("realTradingExperience")),
        realTradesCount: toNumberOrNull(formData.get("realTradesCount")),
        demoTrading: toBool(formData.get("demoTrading")),
      };
    case 3:
      return {
        historicalProfit: toNumberOrNull(formData.get("historicalProfit")),
        historicalLoss: toNumberOrNull(formData.get("historicalLoss")),
        verificationStatus: toText(formData.get("verificationStatus")) ?? "not_provided",
      };
    case 4:
      return {
        employmentStatus: toText(formData.get("employmentStatus")) ?? "not_provided",
        monthlyIncome: toNumberOrNull(formData.get("monthlyIncome")),
      };
    case 5:
      return {
        tradingCapital: toNumberOrNull(formData.get("tradingCapital")),
        tradesRealMoney: toBool(formData.get("tradesRealMoney")),
        demoTrading: toBool(formData.get("demoTrading")),
      };
  }
}

function toProfileUpdate(step: OnboardingStep, values: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = {
    fullName: "full_name",
    fatherName: "father_name",
    dateOfBirth: "date_of_birth",
    country: "country",
    tradingExperience: "trading_experience",
    tradingEducation: "trading_education",
    backtestingExperience: "backtesting_experience",
    backtestedTrades: "backtested_trades",
    realTradingExperience: "real_trading_experience",
    realTradesCount: "real_trades_count",
    demoTrading: "demo_trading",
    historicalProfit: "historical_profit",
    historicalLoss: "historical_loss",
    // verificationStatus is intentionally absent: it is a
    // self-declaration stored in onboarding answers only, never
    // written to profiles (see ONBOARDING_PROFILE_COLUMNS).
    employmentStatus: "employment_status",
    monthlyIncome: "monthly_income",
    tradingCapital: "trading_capital",
    tradesRealMoney: "trades_real_money",
  };
  const out: Record<string, unknown> = {};
  for (const col of ONBOARDING_PROFILE_COLUMNS[step]) {
    const key = Object.keys(map).find((k) => map[k] === col);
    if (key && key in values) out[col] = values[key];
  }
  return out;
}

export async function saveOnboardingStepAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const step = Number(formData.get("step")) as OnboardingStep;
  if (![1, 2, 3, 4, 5].includes(step)) return { ok: false, error: "Invalid onboarding step." };
  const schema = onboardingStepSchemas[step - 1];
  const parsed = schema.safeParse(stepFormValues(step, formData));
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are not logged in. Please log in and try again." };

  const values = parsed.data as Record<string, unknown>;
  const { error: profileError } = await supabase
    .from("profiles")
    .update(toProfileUpdate(step, values))
    .eq("id", user.id);
  if (profileError) return { ok: false, error: "Could not save this step. Please try again." };

  // Merge answers into the onboarding row (answers = the trader's own words).
  const { data: existing } = await supabase
    .from("onboarding_profiles")
    .select("answers")
    .eq("user_id", user.id)
    .maybeSingle();
  const merged = { ...((existing?.answers as Record<string, unknown>) ?? {}), ...values };
  const { error: onboardError } = await supabase.from("onboarding_profiles").upsert({
    user_id: user.id,
    is_complete: false,
    current_step: Math.min(step + 1, 5),
    answers: merged,
  });
  if (onboardError) return { ok: false, error: "Could not save this step. Please try again." };

  await writeAuditLog({
    userId: user.id,
    action: "onboarding.step_saved",
    entityType: "onboarding_profiles",
    details: { step },
  });
  return { ok: true, redirectTo: step === 5 ? "/onboarding?done=1" : "/onboarding" };
}

export async function completeOnboardingAction(): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are not logged in." };
  const { error } = await supabase
    .from("onboarding_profiles")
    .update({ is_complete: true, completed_at: new Date().toISOString(), current_step: 5 })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not complete onboarding. Please try again." };
  await writeAuditLog({ userId: user.id, action: "onboarding.completed", entityType: "onboarding_profiles" });
  return { ok: true, redirectTo: "/dashboard" };
}

/* ---------------------------------------------------------------- profile */

export async function updateProfileAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = profileEditSchema.safeParse({
    fullName: toText(formData.get("fullName")),
    fatherName: toText(formData.get("fatherName")),
    dateOfBirth: toText(formData.get("dateOfBirth")),
    country: toText(formData.get("country")),
    tradingExperience: toText(formData.get("tradingExperience")),
    tradingEducation: toText(formData.get("tradingEducation")),
    backtestingExperience: toBool(formData.get("backtestingExperience")),
    backtestedTrades: toNumberOrNull(formData.get("backtestedTrades")),
    realTradingExperience: toBool(formData.get("realTradingExperience")),
    realTradesCount: toNumberOrNull(formData.get("realTradesCount")),
    demoTrading: toBool(formData.get("demoTrading")),
    employmentStatus: toText(formData.get("employmentStatus")) ?? "not_provided",
    monthlyIncome: toNumberOrNull(formData.get("monthlyIncome")),
    tradingCapital: toNumberOrNull(formData.get("tradingCapital")),
    tradesRealMoney: toBool(formData.get("tradesRealMoney")),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are not logged in." };
  // Phase 21 (M1): the update itself lives in the shared
  // profile service core (lib/profile/service.ts).
  const result = await updateProfileCore(supabase, user.id, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: "Profile saved." };
}

/**
 * Avatar upload — real Supabase Storage when configured, otherwise
 * an honest error. No fake upload, no local placeholder image
 * presented as a photo. Requires a Storage bucket named `avatars`
 * (created as part of Supabase setup, Phase 13). Max 2 MB, images only.
 */
export async function uploadAvatarAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const file = formData.get("avatar");
  const fileError = avatarFileError(file instanceof File ? file : null);
  if (fileError) return { ok: false, error: fileError };
  if (!(file instanceof File)) {
    return { ok: false, error: "Choose an image file first." };
  }
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are not logged in." };
  // Phase 21 (M1): rate limit, storage upload and the
  // profile update live in the shared profile service core
  // (lib/profile/service.ts).
  const result = await uploadAvatarCore(supabase, user.id, file);
  if (!result.ok) return { ok: false, error: result.error };
  // Show the new photo immediately: without this, the profile
  // page kept rendering the previous avatar until the next
  // navigation/reload even though the upload had succeeded.
  revalidatePath("/profile");
  return { ok: true, message: "Profile photo updated." };
}
