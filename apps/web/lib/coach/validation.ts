import { z } from "zod";

/**
 * AI Coach validation (Phase 9, spec §28, §39).
 *
 * Refreshing the analysis needs only a week (Monday). Logging a
 * backtesting session needs a date and the TOTAL number of
 * sessions done that day — a total, not an increment, so
 * re-submitting the same day never double-awards XP (see
 * actions.ts).
 */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).");

export const refreshCoachSchema = z.object({
  weekStartDate: dateString,
});

export const backtestingSchema = z.object({
  activityDate: dateString,
  sessions: z.coerce
    .number()
    .int("Sessions must be a whole number.")
    .min(1, "Log at least 1 backtesting session.")
    .max(10, "Log at most 10 sessions in one day."),
});

export type RefreshCoachInput = z.infer<typeof refreshCoachSchema>;
export type BacktestingInput = z.infer<typeof backtestingSchema>;

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
