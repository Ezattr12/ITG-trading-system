import { z } from "zod";

/**
 * Risk rules & trading-plan validation (Phase 5, spec §19–20).
 *
 * Every limit is optional: a blank field means "no limit set" and
 * the engine skips that check. Bounds keep the rules sane — a
 * 0% risk-per-trade or a 10 000× leverage limit is a typo, not a plan.
 */

export const riskRulesSchema = z.object({
  maxRiskPerTradePct: z
    .number()
    .min(0.1, "Risk per trade must be at least 0.1%.")
    .max(100, "Risk per trade must be at most 100%.")
    .nullable(),
  maxDailyLoss: z
    .number()
    .min(0, "Maximum daily loss cannot be negative.")
    .nullable(),
  maxTradesPerDay: z
    .number()
    .int("Maximum trades per day must be a whole number.")
    .min(1, "Maximum trades per day must be at least 1.")
    .max(100, "Maximum trades per day must be at most 100.")
    .nullable(),
  maxConsecutiveLosses: z
    .number()
    .int("Maximum consecutive losses must be a whole number.")
    .min(1, "Maximum consecutive losses must be at least 1.")
    .max(50, "Maximum consecutive losses must be at most 50.")
    .nullable(),
  maxLeverage: z
    .number()
    .min(1, "Maximum leverage must be at least 1×.")
    .max(500, "Maximum leverage must be at most 500×.")
    .nullable(),
});

export type RiskRulesInput = z.infer<typeof riskRulesSchema>;

export const tradingPlanSchema = z.object({
  name: z.string().trim().min(1, "Give the plan a name.").max(120),
  markets: z
    .array(z.string().trim().min(1).max(40))
    .max(30, "List at most 30 markets."),
  sessions: z.array(
    z.enum(["asia", "london", "new_york", "other"]),
  ),
  riskPerTradePct: z
    .number()
    .min(0.1, "Risk per trade must be at least 0.1%.")
    .max(100, "Risk per trade must be at most 100%.")
    .nullable(),
  maxDailyLoss: z
    .number()
    .min(0, "Maximum daily loss cannot be negative.")
    .nullable(),
  maxDailyTrades: z
    .number()
    .int("Maximum daily trades must be a whole number.")
    .min(1, "Maximum daily trades must be at least 1.")
    .max(100, "Maximum daily trades must be at most 100.")
    .nullable(),
  preferredSetupIds: z.array(z.string().uuid()),
  noTradeConditions: z.string().trim().max(2000).nullable(),
  psychologyRules: z.string().trim().max(2000).nullable(),
  scheduleNotes: z.string().trim().max(1000).nullable(),
});

export type TradingPlanInput = z.infer<typeof tradingPlanSchema>;

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
