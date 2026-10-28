import { describe, expect, it } from "vitest";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  onboardingPersonalSchema,
  onboardingWorkSchema,
  onboardingHistorySchema,
  ONBOARDING_PROFILE_COLUMNS,
} from "./validation";

describe("ONBOARDING_PROFILE_COLUMNS (Phase 11 privilege guard)", () => {
  it("never lets onboarding write role or verification_status", () => {
    for (const step of [1, 2, 3, 4, 5]) {
      expect(ONBOARDING_PROFILE_COLUMNS[step]).not.toContain("role");
      expect(ONBOARDING_PROFILE_COLUMNS[step]).not.toContain("verification_status");
    }
  });

  it("step 3 writes only historical profit and loss", () => {
    expect(ONBOARDING_PROFILE_COLUMNS[3]).toEqual(["historical_profit", "historical_loss"]);
  });

  it("still validates the trader's verification self-declaration", () => {
    // The answer is collected (and stored in onboarding answers),
    // it is just never written to profiles.verification_status.
    expect(
      onboardingHistorySchema.safeParse({
        historicalProfit: null,
        historicalLoss: null,
        verificationStatus: "partial",
      }).success,
    ).toBe(true);
    expect(
      onboardingHistorySchema.safeParse({
        historicalProfit: null,
        historicalLoss: null,
        verificationStatus: "self_verified",
      }).success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts a valid email and password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
  it("rejects an invalid email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = {
    fullName: "Ezat Khan",
    email: "a@b.co",
    password: "Password1",
    confirmPassword: "Password1",
  };
  it("accepts a valid registration", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects mismatched passwords", () => {
    expect(registerSchema.safeParse({ ...valid, confirmPassword: "Password2" }).success).toBe(false);
  });
  it("rejects a password without a number", () => {
    expect(registerSchema.safeParse({ ...valid, password: "Password", confirmPassword: "Password" }).success).toBe(false);
  });
  it("rejects a password shorter than 8 characters", () => {
    expect(registerSchema.safeParse({ ...valid, password: "Pass1", confirmPassword: "Pass1" }).success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("rejects an invalid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("onboarding schemas — never force fake data (spec §7)", () => {
  it("step 1 requires only a full name", () => {
    expect(onboardingPersonalSchema.safeParse({ fullName: "Ezat" }).success).toBe(true);
    expect(onboardingPersonalSchema.safeParse({ fullName: "" }).success).toBe(false);
  });
  it("step 3 allows missing profit/loss with 'not_provided'", () => {
    expect(
      onboardingHistorySchema.safeParse({
        historicalProfit: null,
        historicalLoss: null,
        verificationStatus: "not_provided",
      }).success,
    ).toBe(true);
  });
  it("step 3 rejects negative profit", () => {
    expect(
      onboardingHistorySchema.safeParse({
        historicalProfit: -1,
        verificationStatus: "not_provided",
      }).success,
    ).toBe(false);
  });
  it("step 4 requires monthly income only when employed elsewhere", () => {
    expect(
      onboardingWorkSchema.safeParse({ employmentStatus: "employed_other_job", monthlyIncome: null }).success,
    ).toBe(false);
    expect(
      onboardingWorkSchema.safeParse({ employmentStatus: "studying", monthlyIncome: null }).success,
    ).toBe(true);
  });
});
