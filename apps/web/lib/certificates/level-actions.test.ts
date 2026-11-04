import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * Level certificate action tests (Task 24): issuance is a
 * credential event built on Task 23's pass assessments.
 *
 * Pinned here:
 * - a certificate is issued ONLY for the signed-in trader's
 *   own PASSED assessment, with the band/date/score snapshot
 *   read from the stored assessment row (never the client);
 * - issuance is idempotent per (user, assessment) — a second
 *   issue returns the existing certificate and writes nothing;
 * - a hold, another trader's pass, or an unknown id refuses
 *   with one error and writes nothing;
 * - a real issue writes the `certificate.issued` audit row
 *   (kind: level) and the achievement notification, exactly
 *   like the monthly flow.
 *
 * The Supabase server module, the session and the notification
 * engine are mocked; the assessment/certificate reads and
 * writes run against the fake.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
  notifications: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => harness.adminClient,
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
vi.mock("@/lib/discipline/service", () => ({
  createNotification: async (input: Record<string, unknown>) => {
    harness.notifications.push(input);
    return true;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { issueLevelCertificateAction } from "./level-actions";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PASS = {
  id: "assessment-1",
  user_id: USER,
  level_slug: "strategy-operator",
  level_name: "Strategy Operator",
  score: 59.2,
  verdict: "pass",
  created_at: "2026-11-03T10:00:00Z",
};

function setup(assessments: Row[], certificates: Row[] = []) {
  const tables: Record<string, Row[]> = {
    level_assessments: assessments,
    certificates,
    audit_logs: [],
  };
  const admin = fakeSupabase(tables);
  harness.adminClient = admin.fake;
  harness.notifications = [];
  return { admin, tables };
}

function form(assessmentId?: string): FormData {
  const fd = new FormData();
  if (assessmentId !== undefined) fd.set("assessmentId", assessmentId);
  return fd;
}

beforeEach(() => {
  harness.adminClient = null;
  harness.notifications = [];
});

describe("issueLevelCertificateAction", () => {
  it("issues for a passed assessment with the snapshot read from the stored row", async () => {
    const { admin } = setup([PASS]);
    const result = await issueLevelCertificateAction({ ok: false }, form("assessment-1"));
    expect(result.ok).toBe(true);
    expect(result.certificateId).toMatch(/^ITG-\d{6}-[0-9A-F]{6}$/);

    const certs = admin.fake.insertsFor("certificates");
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({
      user_id: USER,
      kind: "level",
      month: null,
      assessment_id: "assessment-1",
      level_slug: "strategy-operator",
      level_name: "Strategy Operator",
      assessment_score: 59.2,
      assessed_at: "2026-11-03T10:00:00Z",
      status: "issued",
    });

    const audit = admin.fake.insertsFor("audit_logs");
    expect(
      audit.some(
        (r) =>
          r.action === "certificate.issued" &&
          // entity_id is a uuid column: the certificate ROW id,
          // never the human certificate_id — Postgres rejects
          // "ITG-…" there and writeAuditLog swallows the error
          // (the Task 24 production finding). The human id
          // stays traceable in details.certificate_id.
          r.entity_id === certs[0].id &&
          r.entity_id !== result.certificateId &&
          (r.details as Record<string, unknown>)?.kind === "level" &&
          (r.details as Record<string, unknown>)?.assessment_id === "assessment-1" &&
          (r.details as Record<string, unknown>)?.certificate_id === result.certificateId,
      ),
    ).toBe(true);

    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0]).toMatchObject({
      type: "achievement",
      title: "Level certificate issued",
      // related_entity_id is a uuid column too: the row id.
      relatedEntityId: certs[0].id,
    });
  });

  it("a second issue for the same assessment returns the existing certificate, writing nothing", async () => {
    const { admin } = setup(
      [PASS],
      [
        {
          id: "cert-row-1",
          user_id: USER,
          certificate_id: "ITG-202611-ABC123",
          kind: "level",
          assessment_id: "assessment-1",
          status: "issued",
        },
      ],
    );
    const result = await issueLevelCertificateAction({ ok: false }, form("assessment-1"));
    expect(result.ok).toBe(true);
    expect(result.certificateId).toBe("ITG-202611-ABC123");
    expect(admin.fake.insertsFor("certificates")).toHaveLength(0);
    expect(admin.fake.insertsFor("audit_logs")).toHaveLength(0);
    expect(harness.notifications).toHaveLength(0);
  });

  it("a hold assessment issues nothing", async () => {
    const { admin } = setup([{ ...PASS, verdict: "hold" }]);
    const result = await issueLevelCertificateAction({ ok: false }, form("assessment-1"));
    expect(result.ok).toBe(false);
    expect(admin.fake.insertsFor("certificates")).toHaveLength(0);
    expect(admin.fake.insertsFor("audit_logs")).toHaveLength(0);
    expect(harness.notifications).toHaveLength(0);
  });

  it("another trader's pass issues nothing and is not revealed", async () => {
    const { admin } = setup([{ ...PASS, user_id: OTHER }]);
    const result = await issueLevelCertificateAction({ ok: false }, form("assessment-1"));
    expect(result.ok).toBe(false);
    expect(admin.fake.insertsFor("certificates")).toHaveLength(0);
    expect(admin.fake.insertsFor("audit_logs")).toHaveLength(0);
  });

  it("an unknown assessment id issues nothing", async () => {
    const { admin } = setup([PASS]);
    const result = await issueLevelCertificateAction({ ok: false }, form("no-such-id"));
    expect(result.ok).toBe(false);
    expect(admin.fake.insertsFor("certificates")).toHaveLength(0);
  });

  it("a missing assessment id is refused before any write", async () => {
    const { admin } = setup([PASS]);
    const result = await issueLevelCertificateAction({ ok: false }, form());
    expect(result.ok).toBe(false);
    expect(admin.fake.insertsFor("certificates")).toHaveLength(0);
  });
});
