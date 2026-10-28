import { z } from "zod";

/**
 * Zod schemas for every auth / onboarding / profile boundary (Phase 2).
 * Server Actions parse with these first and reject before touching
 * Supabase. Client forms use the same schemas for instant feedback,
 * but the server check is the authoritative one.
 *
 * Spec §7: any field a trader does not have may be "Not available" /
 * "Not provided" — never force fake information. Optional fields are
 * therefore nullable/optional here, and the UI offers an explicit
 * "Not provided" choice where the DB enum has that value.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address")
  .max(254, "Email is too long");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[0-9]/, "Password must contain a number");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Full name is required")
      .max(120, "Full name is too long"),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
    code: z.string().optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const employmentStatusSchema = z.enum([
  "full_time",
  "part_time",
  "employed_other_job",
  "unemployed",
  "studying",
  "not_provided",
]);

export const verificationStatusSchema = z.enum([
  "not_provided",
  "partial",
  "verified",
]);

const optionalText = z
  .string()
  .trim()
  .max(200, "Value is too long")
  .nullable()
  .optional();
const optionalMoney = z
  .number()
  .finite()
  .nonnegative("Amount cannot be negative")
  .nullable()
  .optional();
const optionalCount = z
  .number()
  .int("Enter a whole number")
  .nonnegative("Count cannot be negative")
  .max(1_000_000, "Count is too large")
  .nullable()
  .optional();

/** Step 1 — Personal information (spec §7). */
export const onboardingPersonalSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(120),
  fatherName: optionalText,
  dateOfBirth: z.string().nullable().optional(),
  country: optionalText,
});

/** Step 2 — Trading background. */
export const onboardingBackgroundSchema = z.object({
  tradingExperience: optionalText,
  tradingEducation: optionalText,
  backtestingExperience: z.boolean(),
  backtestedTrades: optionalCount,
  realTradingExperience: z.boolean(),
  realTradesCount: optionalCount,
  demoTrading: z.boolean(),
});

/** Step 3 — Historical performance. Missing = Not Provided.
 * The trader's verification answer is a SELF-DECLARATION: it is
 * validated here and stored in onboarding_profiles.answers, but
 * it is never written to profiles.verification_status (see
 * ONBOARDING_PROFILE_COLUMNS below). Only an admin may set that
 * field — enforced by the migration 0015 trigger as well. */
export const onboardingHistorySchema = z.object({
  historicalProfit: optionalMoney,
  historicalLoss: optionalMoney,
  verificationStatus: verificationStatusSchema,
});

/**
 * Which profile columns each onboarding step may write (Phase 2,
 * hardened in Phase 11).
 *
 * `verification_status` is deliberately NOT in step 3: a trader
 * must never be able to mark themselves verified, through the app
 * or the API. `role` is never writable from onboarding either.
 * The privileged columns are admin-set (lib/admin/actions.ts,
 * service role) and protected by the migration 0015 trigger.
 */
export const ONBOARDING_PROFILE_COLUMNS: Record<number, string[]> = {
  1: ["full_name", "father_name", "date_of_birth", "country"],
  2: ["trading_experience", "trading_education", "backtesting_experience", "backtested_trades", "real_trading_experience", "real_trades_count", "demo_trading"],
  3: ["historical_profit", "historical_loss"],
  4: ["employment_status", "monthly_income"],
  5: ["trading_capital", "trades_real_money", "demo_trading"],
};

/** Step 4 — Current work. Monthly income only when employed elsewhere. */
export const onboardingWorkSchema = z
  .object({
    employmentStatus: employmentStatusSchema,
    monthlyIncome: optionalMoney,
  })
  .refine(
    (d) =>
      d.employmentStatus !== "employed_other_job" || d.monthlyIncome != null,
    {
      message:
        "Monthly income is requested when you have another job — or choose a different work status.",
      path: ["monthlyIncome"],
    },
  );

/** Step 5 — Trading capital. */
export const onboardingCapitalSchema = z.object({
  tradingCapital: optionalMoney,
  tradesRealMoney: z.boolean(),
  demoTrading: z.boolean(),
});

export const onboardingStepSchemas = [
  onboardingPersonalSchema,
  onboardingBackgroundSchema,
  onboardingHistorySchema,
  onboardingWorkSchema,
  onboardingCapitalSchema,
] as const;

export const profileEditSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(120),
  fatherName: optionalText,
  dateOfBirth: z.string().nullable().optional(),
  country: optionalText,
  tradingExperience: optionalText,
  tradingEducation: optionalText,
  backtestingExperience: z.boolean(),
  backtestedTrades: optionalCount,
  realTradingExperience: z.boolean(),
  realTradesCount: optionalCount,
  demoTrading: z.boolean(),
  employmentStatus: employmentStatusSchema,
  monthlyIncome: optionalMoney,
  tradingCapital: optionalMoney,
  tradesRealMoney: z.boolean(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

/** Human-readable first Zod error, for form display. */
export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
