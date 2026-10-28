import { z } from "zod";

/**
 * Zod schemas for every trade boundary (Phase 3, spec §9–16).
 * Server Actions parse with these first and reject before touching
 * Supabase. Client forms use the same rules for instant feedback,
 * but the server check is authoritative.
 *
 * Quick Entry is minimal by design (spec §2, §16): only the fields
 * the system cannot calculate. P&L, ROI, R multiple, risk/reward,
 * win/loss and duration are NEVER in these schemas — they are
 * computed server-side (see lib/trades/calculations.ts).
 */

export const pairSchema = z
  .string()
  .trim()
  .min(1, "Asset / pair is required")
  .max(30, "Asset / pair is too long")
  .transform((s) => s.toUpperCase().replace(/\s+/g, ""))
  .refine((s) => /^[A-Z0-9/_-]+$/.test(s), {
    message: "Asset / pair may only contain letters, numbers, / , _ and -",
  });

export const directionSchema = z.enum(["long", "short"]);

export const marketConditionSchema = z.enum([
  "trending",
  "ranging",
  "choppy",
  "high_volatility",
  "low_volatility",
  "other",
]);

export const tradeReasonSchema = z.enum([
  "strategy",
  "technical_setup",
  "liquidity",
  "news",
  "fomo",
  "revenge",
  "random",
  "other",
]);

export const sessionSchema = z.enum(["asia", "london", "new_york", "other"]);

export const emotionSchema = z.enum([
  "calm",
  "fear",
  "greed",
  "fomo",
  "revenge",
  "neutral",
]);

export const disciplineSchema = z.enum(["good", "average", "poor"]);

export const confidenceSchema = z
  .number()
  .int("Confidence must be a whole number")
  .min(1, "Confidence is 1–5")
  .max(5, "Confidence is 1–5");

const positivePrice = (label: string) =>
  z.number({ invalid_type_error: `${label} must be a number` }).positive(`${label} must be greater than 0`);

const optionalPositivePrice = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .positive(`${label} must be greater than 0`)
    .nullable();

/** Quick Entry (spec §9, §16): minimal fields, 30–60 seconds. */
export const quickTradeSchema = z
  .object({
    pair: pairSchema,
    direction: directionSchema,
    entryPrice: positivePrice("Entry price"),
    exitPrice: optionalPositivePrice("Exit price"),
    tp: optionalPositivePrice("Take profit"),
    sl: optionalPositivePrice("Stop loss"),
    positionSize: z
      .number({ invalid_type_error: "Position size must be a number" })
      .positive("Position size must be greater than 0"),
    leverage: z
      .number({ invalid_type_error: "Leverage must be a number" })
      .min(1, "Leverage must be at least 1")
      .max(500, "Leverage cannot exceed 500"),
    fees: z
      .number({ invalid_type_error: "Fees must be a number" })
      .nonnegative("Fees cannot be negative")
      .nullable()
      .default(null),
    openedAt: z.string().min(1, "Date / time is required"),
    closedAt: z.string().nullable(),
  })
  .refine(
    (d) => d.exitPrice === null || d.closedAt !== null,
    { message: "Closing date / time is required when an exit price is given.", path: ["closedAt"] },
  )
  .refine(
    (d) =>
      d.closedAt === null ||
      Number.isNaN(Date.parse(d.closedAt)) ||
      Date.parse(d.closedAt) >= Date.parse(d.openedAt),
    { message: "Closing time cannot be before the opening time.", path: ["closedAt"] },
  )
  .refine((d) => !Number.isNaN(Date.parse(d.openedAt)), {
    message: "Opening date / time is not valid.",
    path: ["openedAt"],
  });

export type QuickTradeInput = z.infer<typeof quickTradeSchema>;

/**
 * Advanced Review (spec §16): everything optional, never forced.
 * A trade may be saved with Quick Entry alone and reviewed later.
 * strategyId / setupName reference the Phase 1 tables; a setup
 * name the trader types is created as their own setup row.
 */
export const advancedReviewSchema = z.object({
  tradeId: z.string().uuid("Trade is not valid"),
  strategyId: z.string().uuid().nullable(),
  setupName: z.string().trim().max(120, "Setup name is too long").nullable(),
  marketCondition: marketConditionSchema.nullable(),
  tradeReason: tradeReasonSchema.nullable(),
  session: sessionSchema.nullable(),
  confidence: confidenceSchema.nullable(),
  emotion: emotionSchema.nullable(),
  discipline: disciplineSchema.nullable(),
  lesson: z.string().trim().max(2000, "Lesson is too long").nullable(),
  notes: z.string().trim().max(5000, "Notes are too long").nullable(),
});

export type AdvancedReviewInput = z.infer<typeof advancedReviewSchema>;

/** Correction (reversal) uses exactly the Quick Entry fields. */
export const tradeCorrectionSchema = z.object({
  tradeId: z.string().uuid("Trade is not valid"),
  correction: quickTradeSchema,
});

/** List filters (spec §32). All optional; page defaults to 1. */
export const tradeFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  pair: z.string().trim().max(30).optional(),
  direction: directionSchema.optional(),
  strategyId: z.string().uuid().optional(),
  setup: z.string().trim().max(120).optional(),
  session: sessionSchema.optional(),
  outcome: z.enum(["win", "loss", "all"]).optional(),
  confidence: confidenceSchema.optional(),
  emotion: emotionSchema.optional(),
  discipline: disciplineSchema.optional(),
  marketCondition: marketConditionSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type TradeFilters = z.infer<typeof tradeFiltersSchema>;

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/** Human labels for the enum values, shared by list / detail / forms. */
export const MARKET_CONDITION_LABELS: Record<string, string> = {
  trending: "Trending",
  ranging: "Ranging",
  choppy: "Choppy",
  high_volatility: "High Volatility",
  low_volatility: "Low Volatility",
  other: "Other",
};

export const TRADE_REASON_LABELS: Record<string, string> = {
  strategy: "Strategy",
  technical_setup: "Technical Setup",
  liquidity: "Liquidity",
  news: "News",
  fomo: "FOMO",
  revenge: "Revenge",
  random: "Random",
  other: "Other",
};

export const SESSION_LABELS: Record<string, string> = {
  asia: "Asia",
  london: "London",
  new_york: "New York",
  other: "Other",
};

export const EMOTION_LABELS: Record<string, string> = {
  calm: "Calm",
  fear: "Fear",
  greed: "Greed",
  fomo: "FOMO",
  revenge: "Revenge",
  neutral: "Neutral",
};

export const DISCIPLINE_LABELS: Record<string, string> = {
  good: "Good",
  average: "Average",
  poor: "Poor",
};
