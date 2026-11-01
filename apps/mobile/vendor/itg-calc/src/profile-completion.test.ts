import { describe, expect, it } from "vitest";
import {
  calcProfileCompletion,
  PROFILE_VERIFIED_THRESHOLD,
  type ProfileCompletionRow,
} from "./profile-completion";

const empty: ProfileCompletionRow = {
  full_name: null,
  father_name: null,
  date_of_birth: null,
  country: null,
  avatar_url: null,
  trading_experience: null,
  trading_education: null,
  employment_status: null,
};

const complete: ProfileCompletionRow = {
  full_name: "Ezatullah",
  father_name: "Ahmad",
  date_of_birth: "1995-01-01",
  country: "United Kingdom",
  avatar_url: "https://example.com/avatar.jpg",
  trading_experience: "3 years",
  trading_education: "Self-taught",
  employment_status: "employed",
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
    const result = calcProfileCompletion({ ...complete, avatar_url: null });
    expect(result.percent).toBe(88);
    expect(result.verified).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].key).toBe("avatar_url");
    expect(result.nextStep).toBe("Add a profile photo");
  });

  it("whitespace-only values do not count as complete", () => {
    const result = calcProfileCompletion({ ...complete, full_name: "   ", country: "" });
    expect(result.completed).toBe(6);
    expect(result.percent).toBe(75);
    expect(result.verified).toBe(false);
  });

  it("'not_provided' work status does not count as complete", () => {
    const result = calcProfileCompletion({
      ...complete,
      employment_status: "not_provided",
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
  const productionShaped: ProfileCompletionRow = {
    full_name: "A Trader",
    father_name: "B Trader",
    date_of_birth: "1995-01-01",
    country: "United Kingdom",
    avatar_url: "https://example.com/avatar.jpg",
    trading_experience: null,
    trading_education: null,
    employment_status: "not_provided",
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
      employment_status: "not_provided",
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
    const clearers: [string, Partial<ProfileCompletionRow>][] = [
      ["full_name", { full_name: null }],
      ["avatar_url", { avatar_url: null }],
      ["father_name", { father_name: null }],
      ["date_of_birth", { date_of_birth: null }],
      ["country", { country: null }],
      ["trading_experience", { trading_experience: null }],
      ["trading_education", { trading_education: null }],
      ["employment_status", { employment_status: "not_provided" }],
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
      trading_experience: "3 years",
      trading_education: "Self-taught",
      employment_status: "full_time",
    });
    expect(result.percent).toBe(100);
    expect(result.verified).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
});

describe("Ezat acceptance matrix (Profile Correction §5, cases A–G)", () => {
  it("A: no information at all → 0%, all 8 items missing, no badge", () => {
    const result = calcProfileCompletion(empty);
    expect(result.percent).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(8);
    expect(result.missing.map((m) => m.key)).toEqual([
      "full_name",
      "avatar_url",
      "father_name",
      "date_of_birth",
      "country",
      "trading_experience",
      "trading_education",
      "employment_status",
    ]);
    expect(result.verified).toBe(false);
  });

  it("B: exactly one required field (full name) → 13%, the other 7 listed missing", () => {
    const result = calcProfileCompletion({ ...empty, full_name: "Ezatullah" });
    expect(result.completed).toBe(1);
    expect(result.percent).toBe(13);
    expect(result.missing.map((m) => m.key)).toEqual([
      "avatar_url",
      "father_name",
      "date_of_birth",
      "country",
      "trading_experience",
      "trading_education",
      "employment_status",
    ]);
    expect(result.verified).toBe(false);
    expect(result.nextStep).toBe("Add a profile photo");
  });

  it("C: exactly half the required fields (4 of 8) → 50%", () => {
    const result = calcProfileCompletion({
      ...empty,
      full_name: "Ezatullah",
      avatar_url: "https://example.com/avatar.jpg",
      father_name: "Ahmad",
      date_of_birth: "1995-01-01",
    });
    expect(result.completed).toBe(4);
    expect(result.percent).toBe(50);
    expect(result.missing).toHaveLength(4);
    expect(result.verified).toBe(false);
  });

  it("D: all required fields except the photo → 88%, photo is the only missing item, with its hint", () => {
    const result = calcProfileCompletion({ ...complete, avatar_url: null });
    expect(result.percent).toBe(88);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].key).toBe("avatar_url");
    expect(result.missing[0].label).toBe("Profile photo");
    expect(result.missing[0].hint).toBe("Add a profile photo");
    expect(result.nextStep).toBe("Add a profile photo");
    expect(result.verified).toBe(false);
  });

  it("E: all required fields + photo → exactly 100%, Verified ON, nothing missing, no next step", () => {
    const result = calcProfileCompletion(complete);
    expect(result.percent).toBe(100);
    expect(result.completed).toBe(8);
    expect(result.verified).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.nextStep).toBeNull();
  });

  // Case F (100% → remove one required field → percent drops and the
  // badge turns OFF) is covered exhaustively by the per-field
  // removal loop in the regression suite above: it clears each of
  // the 8 fields in turn and asserts verified=false, percent<100
  // and exactly that field missing.

  it("G: every field filled but work status left at the 'not_provided' placeholder → treated as missing, 88%, no badge", () => {
    const result = calcProfileCompletion({
      ...complete,
      employment_status: "not_provided",
    });
    expect(result.completed).toBe(7);
    expect(result.percent).toBe(88);
    expect(result.verified).toBe(false);
    expect(result.missing.map((m) => m.key)).toEqual(["employment_status"]);
  });

  it("G (whitespace): a whitespace-only father's name counts as missing, not provided", () => {
    const result = calcProfileCompletion({ ...complete, father_name: "   " });
    expect(result.completed).toBe(7);
    expect(result.percent).toBe(88);
    expect(result.verified).toBe(false);
    expect(result.missing.map((m) => m.key)).toEqual(["father_name"]);
  });
});
