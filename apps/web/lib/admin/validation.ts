import { z } from "zod";

/** Zod schemas for admin Server Actions (Phase 10). Zod first, Supabase second. */

export const ADMIN_ROLES = ["trader", "admin", "auditor"] as const;
export const VERIFICATION_STATUSES = ["not_provided", "partial", "verified"] as const;
export const ACHIEVEMENT_CATEGORIES = [
  "trades",
  "discipline",
  "journal",
  "risk",
  "backtesting",
  "goals",
  "consistency",
  "other",
] as const;

export const roleChangeSchema = z.object({
  userId: z.string().uuid("Choose a user."),
  role: z.enum(ADMIN_ROLES),
});

export const verificationChangeSchema = z.object({
  userId: z.string().uuid("Choose a user."),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
});

export const revokeCertificateSchema = z.object({
  certificateId: z.string().uuid("Choose a certificate."),
  reason: z
    .string()
    .trim()
    .min(3, "A reason is required to revoke a certificate.")
    .max(500, "Reason must be 500 characters or fewer."),
});

/** Create a new achievement, or update one when `id` is given. */
export const achievementConfigSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Name is required.").max(120),
  slug: z
    .string()
    .trim()
    .min(2, "Slug is required.")
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers and hyphens."),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  category: z.enum(ACHIEVEMENT_CATEGORIES),
  xpReward: z.coerce.number().int("XP reward must be a whole number.").min(0).max(10000),
});

export const levelThresholdSchema = z.object({
  levelId: z.string().uuid("Choose a level."),
  minScore: z.coerce.number().min(0, "Min score must be 0 or more.").max(100),
  maxScore: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : v),
    z.coerce.number().min(0).max(100).nullable(),
  ),
}).refine((v) => v.maxScore === null || v.maxScore > v.minScore, {
  message: "Max score must be greater than min score.",
  path: ["maxScore"],
});

/** Only these keys may be changed from the admin settings page. */
export const SYSTEM_SETTING_KEYS = [
  "registration_open",
  "maintenance_mode",
  "ai_coach_mode",
] as const;

export const systemSettingSchema = z.object({
  key: z.enum(SYSTEM_SETTING_KEYS),
  /** JSON text, parsed and validated here — never stored unparsed. */
  value: z.string().trim().min(1, "A value is required.").refine(
    (v) => {
      try {
        JSON.parse(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Value must be valid JSON (e.g. true, false, \"deterministic\")." },
  ),
}).refine(
  (v) => {
    if (v.key === "ai_coach_mode") {
      try {
        return JSON.parse(v.value) === "deterministic";
      } catch {
        return false;
      }
    }
    return true;
  },
  {
    message:
      "AI Coach mode can only be \"deterministic\" — no external LLM is connected, and an admin setting must not claim one is.",
    path: ["value"],
  },
);

export const financialViewSchema = z.object({
  userId: z.string().uuid("Choose a user."),
  reason: z
    .string()
    .trim()
    .min(3, "A reason is required to view a trader's financial data.")
    .max(500, "Reason must be 500 characters or fewer."),
});

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
