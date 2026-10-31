import { describe, expect, it } from "vitest";
import {
  calcProfileCompletion,
  PROFILE_VERIFIED_THRESHOLD,
  type ProfileCompletionInput,
} from "./completion";

const empty: ProfileCompletionInput = {
  fullName: null,
  fatherName: null,
  dateOfBirth: null,
  country: null,
  avatarUrl: null,
  tradingExperience: null,
  tradingEducation: null,
  employmentStatus: null,
};

const complete: ProfileCompletionInput = {
  fullName: "Ezatullah",
  fatherName: "Ahmad",
  dateOfBirth: "1995-01-01",
  country: "United Kingdom",
  avatarUrl: "https://example.com/avatar.jpg",
  tradingExperience: "3 years",
  tradingEducation: "Self-taught",
  employmentStatus: "employed",
};

describe("calcProfileCompletion", () => {
  it("empty profile is 0% with 8 missing items and no badge", () => {
    const result = calcProfileCompletion(empty);
    expect(result.percent).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(8);
    expect(result.missing).toHaveLength(8);
    expect(result.verified).toBe(false);
    expect(result.nextStep).toBe("Add your full name");
  });

  it("a fully completed profile is 100% and verified", () => {
    const result = calcProfileCompletion(complete);
    expect(result.percent).toBe(100);
    expect(result.completed).toBe(8);
    expect(result.missing).toHaveLength(0);
    expect(result.verified).toBe(true);
    expect(result.nextStep).toBeNull();
  });

  it("7 of 8 items is 88% and NOT verified — the badge needs everything", () => {
    const result = calcProfileCompletion({ ...complete, avatarUrl: null });
    expect(result.percent).toBe(88);
    expect(result.verified).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].key).toBe("avatar_url");
    expect(result.nextStep).toBe("Add a profile photo");
  });

  it("whitespace-only values do not count as complete", () => {
    const result = calcProfileCompletion({ ...complete, fullName: "   ", country: "" });
    expect(result.completed).toBe(6);
    expect(result.percent).toBe(75);
    expect(result.verified).toBe(false);
  });

  it("'not_provided' work status does not count as complete", () => {
    const result = calcProfileCompletion({
      ...complete,
      employmentStatus: "not_provided",
    });
    expect(result.completed).toBe(7);
    expect(result.verified).toBe(false);
    expect(result.missing[0].key).toBe("employment_status");
  });

  it("the verification threshold is 100", () => {
    expect(PROFILE_VERIFIED_THRESHOLD).toBe(100);
  });
});

describe("regression: profile stuck at 63% — work status unreachable from the profile page (M2 correction pass)", () => {
  // The affected account's exact stored shape: identity fields and
  // the avatar are present, the trading-background fields were never
  // filled in, and work status is still the onboarding
  // "not_provided" sentinel. Onboarding step 4 counts that sentinel
  // as an answered step, so onboarding finished — but it is not a
  // real work status, and the web profile page offered no way to
  // change it (it was a hidden carry-over input). The calculator
  // was correct; the requirement was unreachable.
  const productionShaped: ProfileCompletionInput = {
    fullName: "A Trader",
    fatherName: "B Trader",
    dateOfBirth: "1995-01-01",
    country: "United Kingdom",
    avatarUrl: "https://example.com/avatar.jpg",
    tradingExperience: null,
    tradingEducation: null,
    employmentStatus: "not_provided",
  };

  it("the production-shaped profile is 63%, not verified, missing exactly the three background items", () => {
    const result = calcProfileCompletion(productionShaped);
    expect(result.percent).toBe(63);
    expect(result.completed).toBe(5);
    expect(result.total).toBe(8);
    expect(result.verified).toBe(false);
    expect(result.missing.map((m) => m.key)).toEqual([
      "trading_experience",
      "trading_education",
      "employment_status",
    ]);
  });

  it("'not_provided' work status blocks verification even when the other 7 items are present", () => {
    const result = calcProfileCompletion({
      ...complete,
      employmentStatus: "not_provided",
    });
    expect(result.completed).toBe(7);
    expect(result.percent).toBe(88);
    expect(result.verified).toBe(false);
    expect(result.missing.map((m) => m.key)).toEqual(["employment_status"]);
  });

  it("badge derivation: 7 of 8 complete is not verified; 8 of 8 is verified at 100%", () => {
    const seven = calcProfileCompletion({ ...complete, country: null });
    expect(seven.completed).toBe(7);
    expect(seven.verified).toBe(false);
    const eight = calcProfileCompletion(complete);
    expect(eight.completed).toBe(8);
    expect(eight.percent).toBe(100);
    expect(eight.verified).toBe(true);
  });

  it("badge removal: clearing any single item from a complete profile removes verification", () => {
    const clearers: [string, Partial<ProfileCompletionInput>][] = [
      ["full_name", { fullName: null }],
      ["avatar_url", { avatarUrl: null }],
      ["father_name", { fatherName: null }],
      ["date_of_birth", { dateOfBirth: null }],
      ["country", { country: null }],
      ["trading_experience", { tradingExperience: null }],
      ["trading_education", { tradingEducation: null }],
      ["employment_status", { employmentStatus: "not_provided" }],
    ];
    for (const [key, patch] of clearers) {
      const result = calcProfileCompletion({ ...complete, ...patch });
      expect(result.verified, key).toBe(false);
      expect(result.percent, key).toBeLessThan(100);
      expect(result.missing.map((m) => m.key), key).toEqual([key]);
    }
  });

  it("the stuck profile reaches 100% and verifies once the three items are actually provided", () => {
    const result = calcProfileCompletion({
      ...productionShaped,
      tradingExperience: "3 years",
      tradingEducation: "Self-taught",
      employmentStatus: "full_time",
    });
    expect(result.percent).toBe(100);
    expect(result.verified).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
});
