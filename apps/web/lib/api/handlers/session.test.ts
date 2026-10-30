import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile session-bootstrap handler tests (Phase 21, M2):
 * the endpoint that closes the M1 profile-less finding.
 * Existing profile → created:false with zero inserts;
 * missing profile → created:true with the exact web
 * first-login payload; idempotent repeats; identity fields
 * refused before any insert; the API audit row is written
 * only after the profile exists (FK-safe for first-time
 * users); a genuine creation failure is the distinct
 * 422 profile_bootstrap_failed.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("handlers receive clients via deps");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import { handleSessionBootstrap } from "./session";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function attachAuth(fake: unknown, userId: string | null, fullName?: string) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? {
            data: {
              user: {
                id: userId,
                user_metadata: fullName ? { full_name: fullName } : {},
              },
            },
            error: null,
          }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    // A has a profile and completed onboarding; B has neither.
    profiles: [{ id: USER_A, full_name: "Trader A" }],
    onboarding_profiles: [{ user_id: USER_A, is_complete: true }],
    audit_logs: [],
  };
  const a = fakeSupabase(tables);
  const b = fakeSupabase(tables);
  const bad = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  attachAuth(a.fake, USER_A, "Trader A");
  attachAuth(b.fake, USER_B, "Bee Trader");
  attachAuth(bad.fake, null);
  harness.adminClient = admin.fake;
  const audits: ApiAuditEntry[] = [];
  const auditSawProfile: boolean[] = [];
  const deps: ApiDeps = {
    makeTokenClient: (token: string): SupabaseClient =>
      token === "token-a" ? a.client : token === "token-b" ? b.client : bad.client,
    makeAdminClient: () => admin.client,
    auditApi: async (entry) => {
      audits.push(entry);
      // Ordering probe: at the moment the API audit row is
      // written for a bootstrapping user, does the profile
      // already exist? (In production the audit insert has a
      // profiles FK — it must.)
      if (entry.userId) {
        auditSawProfile.push(tables.profiles.some((p) => p.id === entry.userId));
      }
    },
    rateLimit: () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 }),
    now: () => new Date("2026-10-30T12:00:00Z"),
  };
  return { deps, audits, auditSawProfile, tables, a, b, admin };
}

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleSessionBootstrap", () => {
  it("no/invalid token → 401, audited with a null actor, no insert", async () => {
    const { deps, audits, tables } = makeDeps();
    const res = await handleSessionBootstrap({ token: null, body: {} }, deps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      userId: null,
      operation: "session_bootstrap",
      outcome: "unauthenticated",
    });
    expect(tables.profiles).toHaveLength(1);
  });

  it("existing profile → 200 created:false, onboarding state reported, ZERO inserts", async () => {
    const { deps, audits, a, admin } = makeDeps();
    const res = await handleSessionBootstrap({ token: "token-a", body: {} }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile_id: USER_A,
      created: false,
      onboarding_complete: true,
    });
    expect(a.fake.insertsFor("profiles")).toHaveLength(0);
    expect(admin.fake.insertsFor("profiles")).toHaveLength(0);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: USER_A, operation: "session_bootstrap", outcome: "ok" });
  });

  it("missing profile → created:true with exactly the web first-login payload { id, full_name from metadata }", async () => {
    const { deps, b, tables } = makeDeps();
    const res = await handleSessionBootstrap({ token: "token-b", body: {} }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile_id: USER_B,
      created: true,
      onboarding_complete: false,
    });
    const inserts = b.fake.insertsFor("profiles");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({ id: USER_B, full_name: "Bee Trader" });
    expect(tables.profiles.some((p) => p.id === USER_B)).toBe(true);
  });

  it("repeat call → created:false and still exactly one insert (idempotent)", async () => {
    const { deps, b } = makeDeps();
    const first = await handleSessionBootstrap({ token: "token-b", body: {} }, deps);
    expect(first.body.created).toBe(true);
    const second = await handleSessionBootstrap({ token: "token-b", body: {} }, deps);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(b.fake.insertsFor("profiles")).toHaveLength(1);
  });

  it("bodiless call (body null) is accepted — the body is optional", async () => {
    const { deps } = makeDeps();
    const res = await handleSessionBootstrap({ token: "token-a", body: null }, deps);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
  });

  it("body with user_id → 400 naming it, and NO profile insert happens", async () => {
    const { deps, audits, b, tables } = makeDeps();
    const res = await handleSessionBootstrap(
      { token: "token-b", body: { user_id: USER_A } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(String(res.body.message)).toContain("user_id");
    expect(b.fake.insertsFor("profiles")).toHaveLength(0);
    expect(tables.profiles.some((p) => p.id === USER_B)).toBe(false);
    expect(audits[0]).toMatchObject({ outcome: "invalid_argument" });
  });

  it("unknown key → 400 naming it", async () => {
    const { deps } = makeDeps();
    const res = await handleSessionBootstrap(
      { token: "token-a", body: { anything: 1 } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("anything");
  });

  it("the API audit row is written AFTER the profile exists (first-time user is auditable)", async () => {
    const { deps, audits, auditSawProfile } = makeDeps();
    const res = await handleSessionBootstrap({ token: "token-b", body: {} }, deps);
    expect(res.status).toBe(200);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: USER_B, outcome: "ok" });
    // The ordering probe inside auditApi observed the
    // profile row already present when the audit was taken.
    expect(auditSawProfile).toEqual([true]);
  });

  it("a token for B can only ever bootstrap B — no path creates A's profile", async () => {
    const { deps, tables } = makeDeps();
    await handleSessionBootstrap({ token: "token-b", body: {} }, deps);
    const created = tables.profiles.filter((p) => p.id !== USER_A);
    expect(created).toEqual([{ id: USER_B, full_name: "Bee Trader" }]);
  });

  it("genuine insert failure → distinct 422 profile_bootstrap_failed, no internals leaked", async () => {
    const { deps, audits } = makeDeps();
    const failingClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: USER_C, user_metadata: { full_name: "Cee" } } },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: "42501", message: "row-level security internal detail" },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    deps.makeTokenClient = () => failingClient;
    const res = await handleSessionBootstrap({ token: "token-c", body: {} }, deps);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("profile_bootstrap_failed");
    expect(String(res.body.message)).not.toContain("row-level security");
    expect(audits[0]).toMatchObject({ userId: USER_C, outcome: "profile_bootstrap_failed" });
  });
});
