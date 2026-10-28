import { z } from "zod";

/**
 * Goal validation (Phase 6, spec §21).
 *
 * A goal needs a title, a period, a type and a positive target.
 * The target unit is free text (e.g. "trades", "hours"). Dates are
 * YYYY-MM-DD; an end date, when given, must not precede the start.
 */

export const goalPeriods = ["daily", "weekly", "monthly", "yearly"] as const;
export const goalTypes = [
  "max_trades",
  "journal_completion",
  "study_hours",
  "backtesting_sessions",
  "trading_sessions",
  "risk_discipline",
  "performance_target",
  "other",
] as const;
export const goalStatuses = ["active", "completed", "paused", "failed"] as const;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).");

export const goalSchema = z
  .object({
    title: z.string().trim().min(1, "Give the goal a title.").max(120),
    period: z.enum(goalPeriods),
    goalType: z.enum(goalTypes),
    targetValue: z
      .number()
      .positive("The target must be greater than 0.")
      .max(1_000_000, "The target is too large."),
    targetUnit: z.string().trim().max(40).nullable(),
    startDate: dateString,
    endDate: dateString.nullable(),
  })
  .refine((v) => v.endDate === null || v.endDate >= v.startDate, {
    message: "The end date cannot be before the start date.",
    path: ["endDate"],
  });

export type GoalInput = z.infer<typeof goalSchema>;

export const goalProgressSchema = z.object({
  goalId: z.string().uuid("Choose a goal first."),
  currentValue: z
    .number()
    .min(0, "Progress cannot be negative.")
    .max(1_000_000, "Progress is too large."),
  note: z.string().trim().max(500).nullable(),
});

export type GoalProgressInput = z.infer<typeof goalProgressSchema>;

export const goalStatusSchema = z.object({
  goalId: z.string().uuid("Choose a goal first."),
  status: z.enum(goalStatuses),
});

export type GoalStatusInput = z.infer<typeof goalStatusSchema>;

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
