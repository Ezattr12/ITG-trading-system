import { describe, expect, it } from "vitest";
import {
  achievementConfigSchema,
  financialViewSchema,
  levelThresholdSchema,
  revokeCertificateSchema,
  roleChangeSchema,
  systemSettingSchema,
  verificationChangeSchema,
} from "./validation";

describe("admin validation", () => {
  it("accepts a valid role change and rejects an unknown role", () => {
    expect(
      roleChangeSchema.safeParse({
        userId: "123e4567-e89b-12d3-a456-426614174000",
        role: "admin",
      }).success,
    ).toBe(true);
    expect(
      roleChangeSchema.safeParse({
        userId: "123e4567-e89b-12d3-a456-426614174000",
        role: "superuser",
      }).success,
    ).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: "not-a-uuid", role: "admin" }).success).toBe(false);
  });

  it("accepts the three verification statuses only", () => {
    const base = { userId: "123e4567-e89b-12d3-a456-426614174000" };
    expect(verificationChangeSchema.safeParse({ ...base, verificationStatus: "verified" }).success).toBe(true);
    expect(verificationChangeSchema.safeParse({ ...base, verificationStatus: "approved" }).success).toBe(false);
  });

  it("certificate revoke requires a reason", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(revokeCertificateSchema.safeParse({ certificateId: id, reason: "Issued in error." }).success).toBe(true);
    expect(revokeCertificateSchema.safeParse({ certificateId: id, reason: "" }).success).toBe(false);
    expect(revokeCertificateSchema.safeParse({ certificateId: id, reason: "  " }).success).toBe(false);
    expect(revokeCertificateSchema.safeParse({ certificateId: id }).success).toBe(false);
  });

  it("financial view requires a reason", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(financialViewSchema.safeParse({ userId: id, reason: "Verification review." }).success).toBe(true);
    expect(financialViewSchema.safeParse({ userId: id, reason: "" }).success).toBe(false);
  });

  it("achievement config requires a valid slug and non-negative XP", () => {
    const base = {
      name: "First Trade",
      slug: "first-trade",
      description: "",
      category: "trades",
      xpReward: 50,
    };
    expect(achievementConfigSchema.safeParse(base).success).toBe(true);
    expect(achievementConfigSchema.safeParse({ ...base, slug: "First Trade!" }).success).toBe(false);
    expect(achievementConfigSchema.safeParse({ ...base, xpReward: -1 }).success).toBe(false);
    expect(achievementConfigSchema.safeParse({ ...base, category: "money" }).success).toBe(false);
  });

  it("level thresholds require max above min, and allow an open-ended max", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(levelThresholdSchema.safeParse({ levelId: id, minScore: 40, maxScore: 59 }).success).toBe(true);
    expect(levelThresholdSchema.safeParse({ levelId: id, minScore: 80, maxScore: "" }).success).toBe(true);
    expect(levelThresholdSchema.safeParse({ levelId: id, minScore: 60, maxScore: 59 }).success).toBe(false);
  });

  it("system settings reject any claim that an LLM is connected", () => {
    expect(systemSettingSchema.safeParse({ key: "registration_open", value: "false" }).success).toBe(true);
    expect(systemSettingSchema.safeParse({ key: "ai_coach_mode", value: "\"deterministic\"" }).success).toBe(true);
    // An admin must not be able to set the coach to an LLM mode that does not exist.
    expect(systemSettingSchema.safeParse({ key: "ai_coach_mode", value: "\"gpt-4\"" }).success).toBe(false);
    // llm_connected is not an editable key at all.
    expect(systemSettingSchema.safeParse({ key: "llm_connected", value: "true" }).success).toBe(false);
    expect(systemSettingSchema.safeParse({ key: "registration_open", value: "not json" }).success).toBe(false);
  });
});
