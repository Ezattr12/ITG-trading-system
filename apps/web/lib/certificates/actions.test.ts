import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import type { MonthlyCertificateInputs } from "./eligibility";

/**
 * Certificate action tests (Phase 27): issuance is a credential
 * event. The admin revoke path already wrote an audit row
 * (admin.certificate_revoke); these tests pin the Phase 27 fix
 * that issuance writes `certificate.issued` too — and only on
 * an actual issue, never on an ineligible attempt.
 *
 * The Supabase server module, the session, the certificate
 * inputs query and the notification engine are mocked; the
 * eligibility evaluation itself is the real pure function.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
  userClient: null as unknown,
  inputs: null as MonthlyCertificateInputs | null,
  notifications: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => harness.userClient,
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => ({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "trader@example.com",
    profile: null,
    onboarding: null,
  }),
}));
vi.mock("@/lib/discipline/actions", () => ({
  createNotification: async (input: Record<string, unknown>) => {
    harness.notifications.push(input);
    return true;
  },
}));
vi.mock("./queries", () => ({
  getMonthlyCertificateInputs: async () => harness.inputs,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { issueCertificateAction } from "./actions";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ELIGIBLE: MonthlyCertificateInputs = {
  month: "2026-10-01",
  tradesCount: 10,
  journaledTrades: 9,
  disciplinedTrades: 10,
  criticalBreaches: 0,
  activeDays: 10,
  activeWeeks: 3,
  completedWeeklyReviews: 2,
};

function setup(inputs: MonthlyCertificateInputs) {
  const tables: Record<string, Row[]> = {
    certificates: [],
    audit_logs: [],
  };
  const user = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  harness.userClient = user.fake;
  harness.adminClient = admin.fake;
  harness.inputs = inputs;
  harness.notifications = [];
  return { user, admin, tables };
}

function form(month: string): FormData {
  const fd = new FormData();
  fd.set("month", month);
  return fd;
}

beforeEach(() => {
  harness.adminClient = null;
  harness.userClient = null;
  harness.inputs = null;
  harness.notifications = [];
});

describe("issueCertificateAction", () => {
  it("issues for an eligible month and writes the certificate.issued audit row", async () => {
    const { admin } = setup(ELIGIBLE);
    const result = await issueCertificateAction({ ok: false }, form("2026-10"));
    expect(result.ok).toBe(true);
    expect(result.certificateId).toMatch(/^ITG-202610-[0-9A-F]{6}$/);
    const certs = admin.fake.insertsFor("certificates");
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ user_id: USER, month: "2026-10-01", status: "issued" });
    const audit = admin.fake.insertsFor("audit_logs");
    expect(
      audit.some(
        (r) => r.action === "certificate.issued" && r.entity_id === result.certificateId,
      ),
    ).toBe(true);
  });

  it("an ineligible month issues nothing and writes no audit row", async () => {
    const { admin } = setup({ ...ELIGIBLE, tradesCount: 2, journaledTrades: 2 });
    const result = await issueCertificateAction({ ok: false }, form("2026-10"));
    expect(result.ok).toBe(false);
    expect(admin.fake.insertsFor("certificates")).toHaveLength(0);
    expect(admin.fake.insertsFor("audit_logs")).toHaveLength(0);
  });

  it("a second issue for the same month returns the existing certificate, unaudited as new", async () => {
    const { admin, tables } = setup(ELIGIBLE);
    tables.certificates.push({
      id: "cert-row-1",
      user_id: USER,
      certificate_id: "ITG-202610-ABC123",
      month: "2026-10-01",
      status: "issued",
    });
    const result = await issueCertificateAction({ ok: false }, form("2026-10"));
    expect(result.ok).toBe(true);
    expect(result.certificateId).toBe("ITG-202610-ABC123");
    expect(admin.fake.insertsFor("certificates")).toHaveLength(0);
    expect(admin.fake.insertsFor("audit_logs")).toHaveLength(0);
  });
});
