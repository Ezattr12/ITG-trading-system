import { describe, expect, it } from "vitest";
import {
  isOnboardingComplete,
  isStepComplete,
  nextIncompleteStep,
  onboardingProgressPercent,
  displayOrNotProvided,
  type OnboardingAnswers,
} from "./completion";

const empty: OnboardingAnswers = {};
const complete: OnboardingAnswers = {
  fullName: "Ezat",
  backtestingExperience: true,
  realTradingExperience: false,
  demoTrading: true,
  verificationStatus: "not_provided",
  employmentStatus: "studying",
  tradesRealMoney: false,
};

describe("onboarding completion", () => {
  it("empty answers are 0% and step 1 is next", () => {
    expect(onboardingProgressPercent(empty)).toBe(0);
    expect(nextIncompleteStep(empty)).toBe(1);
    expect(isOnboardingComplete(empty)).toBe(false);
  });
  it("complete answers are 100% with no next step", () => {
    expect(onboardingProgressPercent(complete)).toBe(100);
    expect(nextIncompleteStep(complete)).toBe(null);
    expect(isOnboardingComplete(complete)).toBe(true);
  });
  it("step 1 needs only a full name; other fields never block it", () => {
    expect(isStepComplete(1, { fullName: "Ezat" })).toBe(true);
    expect(isStepComplete(1, { fatherName: "Ali" })).toBe(false);
  });
  it("step 3 is complete with 'not_provided' — missing data is allowed", () => {
    expect(isStepComplete(3, { verificationStatus: "not_provided" })).toBe(true);
  });
  it("step 5 needs an explicit real-money answer", () => {
    expect(isStepComplete(5, {})).toBe(false);
    expect(isStepComplete(5, { tradesRealMoney: false })).toBe(true);
  });
});

describe("displayOrNotProvided", () => {
  it("shows 'Not Provided' for missing values, never invents one", () => {
    expect(displayOrNotProvided(null)).toBe("Not Provided");
    expect(displayOrNotProvided(undefined)).toBe("Not Provided");
    expect(displayOrNotProvided("")).toBe("Not Provided");
    expect(displayOrNotProvided("Gold")).toBe("Gold");
    expect(displayOrNotProvided(0)).toBe("0");
  });
});
