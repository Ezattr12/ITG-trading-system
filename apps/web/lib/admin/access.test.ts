import { describe, expect, it } from "vitest";
import {
  adminGate,
  adminWriteGate,
  FINANCIAL_ACCESS_WINDOW_MINUTES,
  hasNoFinancialFields,
  hasRecentFinancialAccess,
  isAdminRole,
  roleChangeError,
  sanitizeAdminUserSummary,
  toAdminUserFinancials,
} from "./access";

describe("admin access control", () => {
  it("only the admin role is an admin", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("trader")).toBe(false);
    expect(isAdminRole("auditor")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });

  it("denies non-admins and signed-out users with a clear reason", () => {
    expect(adminGate({ role: "trader" })).toEqual({
      allowed: false,
      reason: expect.stringContaining("not authorised"),
    });
    expect(adminGate({ role: "auditor" })).toEqual({
      allowed: false,
      reason: expect.stringContaining("not authorised"),
    });
    expect(adminGate(null)).toEqual({
      allowed: false,
      reason: expect.stringContaining("log in"),
    });
    expect(adminGate(undefined)).toEqual({
      allowed: false,
      reason: expect.stringContaining("log in"),
    });
  });

  it("allows admins, and the write gate follows the same rule", () => {
    expect(adminGate({ role: "admin" })).toEqual({ allowed: true });
    expect(adminWriteGate({ role: "admin" })).toEqual({ allowed: true });
    expect(adminWriteGate({ role: "trader" }).allowed).toBe(false);
  });

  it("an admin cannot remove their own admin role", () => {
    expect(roleChangeError("a1", "a1", "trader")).toBe(
      "You cannot remove your own admin role.",
    );
    expect(roleChangeError("a1", "a1", "admin")).toBeNull();
    expect(roleChangeError("a1", "u2", "trader")).toBeNull();
    expect(roleChangeError("a1", "u2", "auditor")).toBeNull();
  });
});

describe("financial-data privacy", () => {
  const fullRow = {
    id: "u1",
    full_name: "Test Trader",
    father_name: "Private",
    date_of_birth: "1990-01-01",
    country: "UK",
    trading_experience: "2 years",
    monthly_income: 5000,
    trading_capital: 10000,
    historical_profit: 1200,
    historical_loss: 300,
    verification_status: "verified",
    role: "trader",
    created_at: "2026-10-01T00:00:00Z",
  };

  it("the admin list summary never contains financial fields", () => {
    const summary = sanitizeAdminUserSummary(fullRow);
    expect(summary).toEqual({
      id: "u1",
      full_name: "Test Trader",
      country: "UK",
      trading_experience: "2 years",
      verification_status: "verified",
      role: "trader",
      created_at: "2026-10-01T00:00:00Z",
    });
    expect(hasNoFinancialFields(summary as unknown as Record<string, unknown>)).toBe(true);
    expect(hasNoFinancialFields(fullRow)).toBe(false);
    expect("monthly_income" in summary).toBe(false);
    expect("trading_capital" in summary).toBe(false);
    expect("historical_profit" in summary).toBe(false);
    expect("father_name" in summary).toBe(false);
    expect("date_of_birth" in summary).toBe(false);
  });

  it("financials are only built through the explicit financials shape", () => {
    const fin = toAdminUserFinancials("u1", fullRow);
    expect(fin).toEqual({
      user_id: "u1",
      monthly_income: 5000,
      trading_capital: 10000,
      historical_profit: 1200,
      historical_loss: 300,
      trades_real_money: false,
    });
  });

  it("a financial view is valid only within the window after the audit-logged action", () => {
    const now = new Date("2026-10-27T12:00:00Z").getTime();
    const recent = {
      action: "admin.financial_view",
      actor_id: "admin1",
      user_id: "u1",
      created_at: "2026-10-27T11:50:00Z",
    };
    expect(hasRecentFinancialAccess([recent], "admin1", "u1", now)).toBe(true);
    // Expired: older than the window.
    const old = { ...recent, created_at: "2026-10-27T11:00:00Z" };
    expect(hasRecentFinancialAccess([old], "admin1", "u1", now)).toBe(false);
    // Wrong admin, wrong trader, or a different action: no access.
    expect(hasRecentFinancialAccess([recent], "admin2", "u1", now)).toBe(false);
    expect(hasRecentFinancialAccess([recent], "admin1", "u2", now)).toBe(false);
    expect(
      hasRecentFinancialAccess([{ ...recent, action: "admin.role_change" }], "admin1", "u1", now),
    ).toBe(false);
    expect(hasRecentFinancialAccess([], "admin1", "u1", now)).toBe(false);
    expect(FINANCIAL_ACCESS_WINDOW_MINUTES).toBe(15);
  });
});
