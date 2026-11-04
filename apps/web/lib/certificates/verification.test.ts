import { describe, expect, it } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { getCertificateVerification } from "./verification";

/**
 * Public verification read tests (Task 24).
 *
 * The verify page is signed-out, so this read is the privacy
 * boundary: it must return exactly the certificate's own public
 * facts — id, kind, status, holder name as stored, what it
 * certifies, issue date — and nothing else. The exact key set
 * is asserted so a future field cannot leak by accident: no
 * user_id, no email, no criteria evidence, no score, no trade
 * data.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const MONTHLY: Row = {
  certificate_id: "ITG-202610-ABC123",
  user_id: USER,
  kind: "monthly",
  month: "2026-10-01",
  status: "issued",
  issued_at: "2026-10-27T00:00:00Z",
  level_name: null,
  assessed_at: null,
};

const LEVEL: Row = {
  certificate_id: "ITG-202611-DEF456",
  user_id: USER,
  kind: "level",
  month: null,
  status: "issued",
  issued_at: "2026-11-04T12:00:00Z",
  level_name: "Strategy Operator",
  assessed_at: "2026-11-03T10:00:00Z",
};

const REVOKED: Row = {
  ...MONTHLY,
  certificate_id: "ITG-202609-111AAA",
  month: "2026-09-01",
  status: "revoked",
};

const WHITELIST_KEYS = [
  "assessedAt",
  "certificateId",
  "found",
  "issuedAt",
  "kind",
  "levelName",
  "month",
  "status",
  "traderName",
];

function setup(certificates: Row[], profiles: Row[]) {
  const { fake } = fakeSupabase({ certificates, profiles });
  return fake as unknown as Parameters<typeof getCertificateVerification>[0];
}

const PROFILE: Row = { id: USER, full_name: "Test Trader" };

describe("getCertificateVerification", () => {
  it("verifies a monthly certificate with exactly the whitelisted shape", async () => {
    const admin = setup([MONTHLY], [PROFILE]);
    const v = await getCertificateVerification(admin, "ITG-202610-ABC123");
    expect(Object.keys(v).sort()).toEqual(WHITELIST_KEYS);
    expect(v).toMatchObject({
      found: true,
      status: "issued",
      kind: "monthly",
      month: "2026-10-01",
      traderName: "Test Trader",
      issuedAt: "2026-10-27T00:00:00Z",
      levelName: null,
      assessedAt: null,
    });
  });

  it("verifies a level certificate by band and assessed date, with no score", async () => {
    const admin = setup([LEVEL], [PROFILE]);
    const v = await getCertificateVerification(admin, "ITG-202611-DEF456");
    expect(Object.keys(v).sort()).toEqual(WHITELIST_KEYS);
    expect(v).toMatchObject({
      found: true,
      status: "issued",
      kind: "level",
      month: null,
      levelName: "Strategy Operator",
      assessedAt: "2026-11-03T10:00:00Z",
    });
    expect(JSON.stringify(v)).not.toContain("59.2");
  });

  it("a revoked certificate is found but reports its revoked status", async () => {
    const admin = setup([REVOKED], [PROFILE]);
    const v = await getCertificateVerification(admin, "ITG-202609-111AAA");
    expect(v.found).toBe(true);
    expect(v.status).toBe("revoked");
  });

  it("an unknown id is a uniform not-found with every field null", async () => {
    const admin = setup([MONTHLY], [PROFILE]);
    const v = await getCertificateVerification(admin, "ITG-202601-ZZZZZZ");
    expect(Object.keys(v).sort()).toEqual(WHITELIST_KEYS);
    expect(v).toEqual({
      found: false,
      certificateId: "ITG-202601-ZZZZZZ",
      status: null,
      kind: null,
      traderName: null,
      month: null,
      levelName: null,
      assessedAt: null,
      issuedAt: null,
    });
  });

  it("a missing profile yields a null holder name, not an error", async () => {
    const admin = setup([MONTHLY], []);
    const v = await getCertificateVerification(admin, "ITG-202610-ABC123");
    expect(v.found).toBe(true);
    expect(v.traderName).toBeNull();
  });

  it("a blank id never reaches the database shape", async () => {
    const admin = setup([MONTHLY], [PROFILE]);
    const v = await getCertificateVerification(admin, "   ");
    expect(v.found).toBe(false);
  });
});
