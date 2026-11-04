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

export interface LevelBandSetRow {
  minScore: number;
  maxScore: number | null;
}

/**
 * Validate a complete level band set (Task 22, from the Task 5
 * evaluation's config-governance requirement). Band membership
 * is resolved by minScore thresholds, so the set must be a
 * clean ladder: it starts at 0, min scores strictly increase,
 * only the top band may be open-ended, and bands are contiguous
 * (each band's max reaches to within one point of the next
 * band's min — no overlaps, no gaps an admin could silently
 * open in the ladder). Returns an error message, or null when
 * the set is valid.
 */
export function validateLevelBandSet(
  bands: readonly LevelBandSetRow[],
): string | null {
  if (bands.length === 0) return "No levels are configured.";
  const sorted = [...bands].sort((a, b) => a.minScore - b.minScore);
  if (sorted[0].minScore !== 0) {
    return "The lowest level must start at a min score of 0.";
  }
  for (let i = 0; i < sorted.length; i++) {
    const band = sorted[i];
    const isTop = i === sorted.length - 1;
    if (band.maxScore !== null && band.maxScore <= band.minScore) {
      return "Each level's max score must be greater than its min score.";
    }
    if (isTop) continue;
    const next = sorted[i + 1];
    if (next.minScore <= band.minScore) {
      return "Level min scores must be strictly increasing.";
    }
    if (band.maxScore === null) {
      return "Only the top level may have no max score.";
    }
    if (band.maxScore >= next.minScore) {
      return "Level bands must not overlap.";
    }
    if (next.minScore - band.maxScore > 1) {
      return "Level bands must be contiguous — leave no gap between bands.";
    }
  }
  return null;
}

/**
 * Validate the `assessment` block of a level's scoring_config
 * (Task 23). The block is optional — a band without one is
 * assessed against the engine's band-derived defaults — but
 * when present it must be well-formed: `bands` an object keyed
 * by level slug, each entry an object whose fields are in
 * range (floor null or 0–100, min_measured a whole number
 * 1–8, confirm_after_days a whole number 1–365). The
 * assessment parser falls back per-field on invalid values at
 * read time; this validator is the governance gate on the
 * admin write path, so a malformed standard is rejected at
 * save instead of silently flowing into assessments. Returns
 * an error message, or null when the config is valid/absent.
 */
export function validateAssessmentConfig(config: unknown): string | null {
  if (config === null || config === undefined) return null;
  if (typeof config !== "object" || Array.isArray(config)) {
    return "The scoring config must be an object.";
  }
  const assessment = (config as Record<string, unknown>).assessment;
  if (assessment === undefined) return null;
  if (assessment === null || typeof assessment !== "object" || Array.isArray(assessment)) {
    return "The assessment config must be an object.";
  }
  const bands = (assessment as Record<string, unknown>).bands;
  if (bands === undefined) return null;
  if (bands === null || typeof bands !== "object" || Array.isArray(bands)) {
    return "The assessment bands config must be an object keyed by level slug.";
  }
  for (const [slug, entry] of Object.entries(bands as Record<string, unknown>)) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return `The assessment band key "${slug}" is not a valid level slug.`;
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return `The assessment standard for "${slug}" must be an object.`;
    }
    const fields = entry as Record<string, unknown>;
    if (
      "floor" in fields &&
      fields.floor !== null &&
      (typeof fields.floor !== "number" ||
        !Number.isFinite(fields.floor) ||
        fields.floor < 0 ||
        fields.floor > 100)
    ) {
      return `The assessment floor for "${slug}" must be null or a number from 0 to 100.`;
    }
    if (
      "min_measured" in fields &&
      (typeof fields.min_measured !== "number" ||
        !Number.isInteger(fields.min_measured) ||
        fields.min_measured < 1 ||
        fields.min_measured > 8)
    ) {
      return `The assessment min_measured for "${slug}" must be a whole number from 1 to 8.`;
    }
    if (
      "confirm_after_days" in fields &&
      (typeof fields.confirm_after_days !== "number" ||
        !Number.isInteger(fields.confirm_after_days) ||
        fields.confirm_after_days < 1 ||
        fields.confirm_after_days > 365)
    ) {
      return `The assessment confirm_after_days for "${slug}" must be a whole number from 1 to 365.`;
    }
  }
  return null;
}

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
