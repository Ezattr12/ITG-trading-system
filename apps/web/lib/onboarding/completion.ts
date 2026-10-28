/**
 * Onboarding completion logic — pure functions, tested in Vitest
 * (Phase 2). No Supabase, no fake data: a step is complete only when
 * its required answers are present, or the trader explicitly chose
 * "Not provided". Optional fields never block completion (spec §7).
 */

export interface OnboardingAnswers {
  fullName?: string | null;
  fatherName?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
  tradingExperience?: string | null;
  tradingEducation?: string | null;
  backtestingExperience?: boolean | null;
  backtestedTrades?: number | null;
  realTradingExperience?: boolean | null;
  realTradesCount?: number | null;
  demoTrading?: boolean | null;
  historicalProfit?: number | null;
  historicalLoss?: number | null;
  verificationStatus?: string | null;
  employmentStatus?: string | null;
  monthlyIncome?: number | null;
  tradingCapital?: number | null;
  tradesRealMoney?: boolean | null;
}

export const ONBOARDING_TOTAL_STEPS = 5;

/** Step 1 is complete when a full name is present. Everything else is optional. */
export function isStep1Complete(a: OnboardingAnswers): boolean {
  return Boolean(a.fullName && a.fullName.trim().length > 0);
}

/** Step 2 is complete when the trader has answered the three yes/no questions. */
export function isStep2Complete(a: OnboardingAnswers): boolean {
  return (
    a.backtestingExperience !== null &&
    a.backtestingExperience !== undefined &&
    a.realTradingExperience !== null &&
    a.realTradingExperience !== undefined &&
    a.demoTrading !== null &&
    a.demoTrading !== undefined
  );
}

/** Step 3 is complete when a verification status is recorded (incl. "not_provided"). */
export function isStep3Complete(a: OnboardingAnswers): boolean {
  return Boolean(a.verificationStatus);
}

/** Step 4 is complete when a work status is recorded (incl. "not_provided"). */
export function isStep4Complete(a: OnboardingAnswers): boolean {
  return Boolean(a.employmentStatus);
}

/** Step 5 is complete when the trader has answered whether they trade real money. */
export function isStep5Complete(a: OnboardingAnswers): boolean {
  return a.tradesRealMoney !== null && a.tradesRealMoney !== undefined;
}

export const stepCompleteFns = [
  isStep1Complete,
  isStep2Complete,
  isStep3Complete,
  isStep4Complete,
  isStep5Complete,
] as const;

export function isStepComplete(step: number, a: OnboardingAnswers): boolean {
  if (step < 1 || step > ONBOARDING_TOTAL_STEPS) return false;
  return stepCompleteFns[step - 1](a);
}

export function completedStepCount(a: OnboardingAnswers): number {
  return stepCompleteFns.filter((fn) => fn(a)).length;
}

export function onboardingProgressPercent(a: OnboardingAnswers): number {
  return Math.round((completedStepCount(a) / ONBOARDING_TOTAL_STEPS) * 100);
}

export function isOnboardingComplete(a: OnboardingAnswers): boolean {
  return stepCompleteFns.every((fn) => fn(a));
}

/** First incomplete step (1–5), or null when onboarding is complete. */
export function nextIncompleteStep(a: OnboardingAnswers): number | null {
  for (let i = 0; i < ONBOARDING_TOTAL_STEPS; i++) {
    if (!stepCompleteFns[i](a)) return i + 1;
  }
  return null;
}

/** Display helper: missing values are "Not Provided", never invented. */
export function displayOrNotProvided(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "Not Provided";
  if (typeof value === "string" && value.trim() === "") return "Not Provided";
  return String(value);
}
