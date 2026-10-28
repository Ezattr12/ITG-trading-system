import { describe, expect, it } from "vitest";
import { securityHeaders } from "./headers";

describe("securityHeaders", () => {
  const headers = securityHeaders();
  const byKey = new Map(headers.map((h) => [h.key, h.value]));

  it("includes every required header exactly once", () => {
    for (const key of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ]) {
      expect(byKey.has(key)).toBe(true);
    }
    expect(headers.length).toBe(6);
  });

  it("denies framing and sniffing", () => {
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("forces HTTPS for two years including subdomains", () => {
    const hsts = byKey.get("Strict-Transport-Security") ?? "";
    expect(hsts).toContain("max-age=63072000");
    expect(hsts).toContain("includeSubDomains");
  });

  it("never allows unsafe-eval and never allows foreign script sources", () => {
    const csp = byKey.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("unsafe-eval");
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toMatch(/https?:/);
    expect(scriptSrc).toContain("'self'");
  });

  it("only allows the app and Supabase as connect sources", () => {
    const csp = byKey.get("Content-Security-Policy") ?? "";
    const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain("https://*.supabase.co");
    expect(connectSrc).toContain("wss://*.supabase.co");
  });

  it("disables camera, microphone and geolocation", () => {
    expect(byKey.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });
});
