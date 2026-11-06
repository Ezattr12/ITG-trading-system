import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile account-deletion handler tests (Google Play
 * release preparation): the destructive path is gated on
 * re-verifying the account password. Wrong password → 403
 * and the deletion core is NEVER invoked; correct password
 * → the core runs once for the token's own user; no token
 * → 401; a smuggled identity field → 400. The core and the
 * password verifier are mocked — these tests pin the
 * pipeline contract, not the core (which is exercised
 * against throwaway accounts only, never in unit tests
 * against real users).
 */

const svc = vi.hoisted(() => ({
  deleteAccountCore: vi.fn(),
  verifyUserPassword: vi.fn(),
}));

vi.mock("@/lib/account/service", () => ({
  deleteAccountCore: svc.deleteAccountCore,
  verifyUserPassword: svc.verifyUserPassword,
}));

import { handleDeleteAccount } from "./account";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMAIL_A = "trader-a@example.com";

function attachAuth(fake: unknown, user: { id: string; email: string } | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      user
        ? { data: { user }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = { audit_logs: [], profiles: [{ id: USER_A }] };
  const a = fakeSupabase(tables);
  const bad = fakeSupabase(tables);
  attachAuth(a.fake, { id: USER_A, email: EMAIL_A });
  attachAuth(bad.fake, null);
  const adminClient = { marker: "admin-client" };
  const audits: ApiAuditEntry[] = [];
  const deps: ApiDeps = {
    makeTokenClient: (token: string): SupabaseClient =>
      token === "token-a" ? a.client : bad.client,
    makeAdminClient: () => adminClient as unknown as SupabaseClient,
    auditApi: async (entry) => {
      audits.push(entry);
    },
    rateLimit: () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 }),
    now: () => new Date("2026-11-06T12:00:00Z"),
  };
  return { deps, audits, adminClient };
}

beforeEach(() => {
  __clearRateLimitBuckets();
  svc.deleteAccountCore.mockReset();
  svc.verifyUserPassword.mockReset();
  svc.deleteAccountCore.mockResolvedValue({
    screenshotsRemoved: 2,
    avatarsRemoved: 1,
    storageError: false,
  });
});

describe("handleDeleteAccount", () => {
  it("no token → 401, password never checked, core never called", async () => {
    const { deps, audits } = makeDeps();
    const res = await handleDeleteAccount({ token: null, body: { password: "secret1" } }, deps);
    expect(res.status).toBe(401);
    expect(svc.verifyUserPassword).not.toHaveBeenCalled();
    expect(svc.deleteAccountCore).not.toHaveBeenCalled();
    expect(audits.filter((e) => e.operation === "account_delete")).toHaveLength(1);
    expect(audits[0].outcome).toBe("unauthenticated");
  });

  it("wrong password → 403 generic message, deleteUser path never reached", async () => {
    const { deps, audits } = makeDeps();
    svc.verifyUserPassword.mockResolvedValue(false);
    const res = await handleDeleteAccount(
      { token: "token-a", body: { password: "wrong-password" } },
      deps,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(svc.verifyUserPassword).toHaveBeenCalledWith(EMAIL_A, "wrong-password");
    expect(svc.deleteAccountCore).not.toHaveBeenCalled();
    expect(audits.filter((e) => e.operation === "account_delete")).toHaveLength(1);
    expect(audits[0].outcome).toBe("forbidden");
  });

  it("correct password → 200 { deleted: true }, core called once with admin client + own id, audit written before the core runs", async () => {
    const { deps, audits, adminClient } = makeDeps();
    svc.verifyUserPassword.mockResolvedValue(true);
    const order: string[] = [];
    svc.deleteAccountCore.mockImplementation(async () => {
      order.push("core");
      return { screenshotsRemoved: 0, avatarsRemoved: 0, storageError: false };
    });
    const auditingDeps: ApiDeps = {
      ...deps,
      auditApi: async (entry) => {
        order.push("audit");
        await deps.auditApi(entry);
      },
    };
    const res = await handleDeleteAccount(
      { token: "token-a", body: { password: "correct-password" } },
      auditingDeps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(svc.deleteAccountCore).toHaveBeenCalledTimes(1);
    expect(svc.deleteAccountCore).toHaveBeenCalledWith(adminClient, USER_A);
    expect(order).toEqual(["audit", "core"]);
    expect(audits.filter((e) => e.operation === "account_delete")).toHaveLength(1);
    expect(audits[0].outcome).toBe("ok");
    expect(audits[0].userId).toBe(USER_A);
  });

  it("unknown body key → 400; smuggled user_id → 400 naming the field; missing password → 400", async () => {
    const { deps } = makeDeps();
    svc.verifyUserPassword.mockResolvedValue(true);
    const unknown = await handleDeleteAccount(
      { token: "token-a", body: { password: "x", confirm: "DELETE" } },
      deps,
    );
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.message)).toContain("confirm");
    const smuggled = await handleDeleteAccount(
      { token: "token-a", body: { password: "x", user_id: USER_A } },
      deps,
    );
    expect(smuggled.status).toBe(400);
    expect(String(smuggled.body.message)).toContain("user_id");
    const missing = await handleDeleteAccount({ token: "token-a", body: {} }, deps);
    expect(missing.status).toBe(400);
    expect(svc.verifyUserPassword).not.toHaveBeenCalled();
    expect(svc.deleteAccountCore).not.toHaveBeenCalled();
  });

  it("core failure → 500 and the single audit row still stands", async () => {
    const { deps, audits } = makeDeps();
    svc.verifyUserPassword.mockResolvedValue(true);
    svc.deleteAccountCore.mockRejectedValue(new Error("auth admin unavailable"));
    const res = await handleDeleteAccount(
      { token: "token-a", body: { password: "correct-password" } },
      deps,
    );
    expect(res.status).toBe(500);
    expect(audits.filter((e) => e.operation === "account_delete")).toHaveLength(1);
  });
});
