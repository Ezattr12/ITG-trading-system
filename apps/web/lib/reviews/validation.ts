import { z } from "zod";

/**
 * Weekly review validation (Phase 8, spec §21, §27).
 *
 * A completed weekly review needs a week and a real reflection:
 * the review text is required (a one-word review earns no XP),
 * the mistake and the next-week focus are optional but
 * encouraged. Dates are YYYY-MM-DD; the week must start on a
 * Monday — the form defaults to the current week's Monday.
 */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).");

export const weeklyReviewSchema = z.object({
  weekStartDate: dateString,
  reviewText: z
    .string()
    .trim()
    .min(10, "Write at least a short reflection (10 characters).")
    .max(5000, "Keep the review under 5,000 characters."),
  mainMistake: z.string().trim().max(500).nullable(),
  focusNextWeek: z.string().trim().max(500).nullable(),
});

export type WeeklyReviewInput = z.infer<typeof weeklyReviewSchema>;

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
