import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile profile handler contract tests (Phase 21): auth,
 * identity-smuggling refusal, strict bodies, avatar rules
 * and token-user scoping against recording fakes.
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

import { handleUpdateProfile, handleUploadAvatar } from "./profile";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function attachAuth(fake: unknown, userId: string | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    profiles: [
      { id: USER_A, full_name: "Trader A", avatar_url: null },
      { id: USER_B, full_name: "Trader B", avatar_url: null },
    ],
    audit_logs: [],
  };
  const a = fakeSupabase(tables);
  const b = fakeSupabase(tables);
  const bad = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  attachAuth(a.fake, USER_A);
  attachAuth(b.fake, USER_B);
  attachAuth(bad.fake, null);
  harness.adminClient = admin.fake;
  const uploads: { bucket: string; path: string }[] = [];
  for (const f of [a.fake, b.fake]) {
    (f as unknown as { storage: unknown }).storage = {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          uploads.push({ bucket, path });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://example.test/storage/${bucket}/${path}` },
        }),
      }),
    };
  }
  const audits: ApiAuditEntry[] = [];
  const deps: ApiDeps = {
    makeTokenClient: (token: string): SupabaseClient =>
      token === "token-a" ? a.client : token === "token-b" ? b.client : bad.client,
    makeAdminClient: () => admin.client,
    auditApi: async (entry) => {
      audits.push(entry);
    },
    rateLimit: () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 }),
    now: () => new Date("2026-10-30T12:00:00Z"),
  };
  return { deps, audits, tables, uploads };
}

const profileBody = {
  fullName: "Renamed A",
  fatherName: null,
  dateOfBirth: null,
  country: "AE",
  tradingExperience: null,
  tradingEducation: null,
  backtestingExperience: false,
  backtestedTrades: null,
  realTradingExperience: true,
  realTradesCount: 12,
  demoTrading: false,
  employmentStatus: "full_time",
  monthlyIncome: null,
  tradingCapital: 10000,
  tradesRealMoney: true,
};

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleUpdateProfile", () => {
  it("no/invalid token → 401", async () => {
    const { deps } = makeDeps();
    expect((await handleUpdateProfile({ token: null, body: profileBody }, deps)).status).toBe(401);
    expect((await handleUpdateProfile({ token: "forged", body: profileBody }, deps)).status).toBe(401);
  });

  it("smuggled profile_id → 400 naming the field, profile untouched", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleUpdateProfile(
      { token: "token-a", body: { ...profileBody, profile_id: USER_B } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("profile_id");
    expect(tables.profiles.find((r) => r.id === USER_A)?.full_name).toBe("Trader A");
  });

  it("happy path → 200; only the token user's profile changes", async () => {
    const { deps, tables, audits } = makeDeps();
    const res = await handleUpdateProfile({ token: "token-a", body: profileBody }, deps);
    expect(res.status).toBe(200);
    const profile = res.body.profile as Row;
    expect(profile.full_name).toBe("Renamed A");
    expect(tables.profiles.find((r) => r.id === USER_A)?.full_name).toBe("Renamed A");
    expect(tables.profiles.find((r) => r.id === USER_B)?.full_name).toBe("Trader B");
    expect(audits.filter((e) => e.operation === "profile_updated")).toHaveLength(1);
  });

  it("zod-invalid body (empty fullName) → 400 with the schema message", async () => {
    const { deps } = makeDeps();
    const res = await handleUpdateProfile(
      { token: "token-a", body: { ...profileBody, fullName: "" } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Full name is required");
  });
});

describe("handleUploadAvatar", () => {
  it("no token → 401 and nothing is uploaded", async () => {
    const { deps, uploads } = makeDeps();
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const res = await handleUploadAvatar({ token: null, file }, deps);
    expect(res.status).toBe(401);
    expect(uploads).toHaveLength(0);
  });

  it("happy path → 200 with avatar_url; stored under the token user's path", async () => {
    const { deps, tables, uploads } = makeDeps();
    const file = new File([new Uint8Array([1, 2])], "me.jpg", { type: "image/jpeg" });
    const res = await handleUploadAvatar({ token: "token-b", file }, deps);
    expect(res.status).toBe(200);
    expect(typeof res.body.avatar_url).toBe("string");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(new RegExp(`^${USER_B}/avatar-\\d+\\.jpg$`));
    expect(tables.profiles.find((r) => r.id === USER_B)?.avatar_url).toBe(res.body.avatar_url);
    expect(tables.profiles.find((r) => r.id === USER_A)?.avatar_url).toBeNull();
  });

  it("missing file → 400 with the shared message; non-image → 400", async () => {
    const { deps } = makeDeps();
    const missing = await handleUploadAvatar({ token: "token-a", file: null }, deps);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe("Choose an image file first.");
    const text = new File(["x"], "x.txt", { type: "text/plain" });
    const notImage = await handleUploadAvatar({ token: "token-a", file: text }, deps);
    expect(notImage.status).toBe(400);
    expect(notImage.body.message).toBe("Only image files can be used as a profile photo.");
  });
});
