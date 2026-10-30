import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

/**
 * Phase 27: the auth callback's `next` parameter must never
 * turn into an off-origin redirect. The dangerous shapes are
 * the ones that survive naive `${origin}${next}` concatenation:
 * userinfo injection (`@host`), protocol-relative (`//host`)
 * and backslash variants.
 */
describe("safeNextPath", () => {
  it("passes legitimate in-app paths through unchanged", () => {
    expect(safeNextPath("/onboarding")).toBe("/onboarding");
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
    expect(safeNextPath("/onboarding?done=1")).toBe("/onboarding?done=1");
    expect(safeNextPath("/trades/abc-123")).toBe("/trades/abc-123");
  });

  it("falls back for missing values", () => {
    expect(safeNextPath(null)).toBe("/onboarding");
    expect(safeNextPath(undefined)).toBe("/onboarding");
    expect(safeNextPath("")).toBe("/onboarding");
    expect(safeNextPath(null, "/login")).toBe("/login");
  });

  it("rejects userinfo injection and absolute URLs", () => {
    expect(safeNextPath("@evil.com")).toBe("/onboarding");
    expect(safeNextPath("https://evil.com")).toBe("/onboarding");
    expect(safeNextPath("evil.com/path")).toBe("/onboarding");
  });

  it("rejects protocol-relative and backslash shapes", () => {
    expect(safeNextPath("//evil.com")).toBe("/onboarding");
    expect(safeNextPath("/\\evil.com")).toBe("/onboarding");
    expect(safeNextPath("/foo\\@evil.com")).toBe("/onboarding");
    expect(safeNextPath("\\\\evil.com")).toBe("/onboarding");
  });
});
