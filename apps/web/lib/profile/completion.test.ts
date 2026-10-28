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
