import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile notifications-read handler tests (Phase 21, M2):
 * exactly one target per call; one of the caller's → 200
 * { updated: 1 }; another trader's id → the identical 404
 * as a nonexistent one; { all: true } flips only the
 * caller's unread rows and reports the real count.
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

import { handleMarkNotificationsRead } from "./notifications";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTE_A1 = "11111111-1111-4111-8111-111111111111";
const NOTE_A2 = "22222222-2222-4222-8222-222222222222";
const NOTE_A_READ = "33333333-3333-4333-8333-333333333333";
const NOTE_B = "44444444-4444-4444-8444-444444444444";

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
    notifications: [
      { id: NOTE_A1, user_id: USER_A, is_read: false, type: "weekly_report" },
      { id: NOTE_A2, user_id: USER_A, is_read: false, type: "achievement" },
      { id: NOTE_A_READ, user_id: USER_A, is_read: true, type: "system" },
      { id: NOTE_B, user_id: USER_B, is_read: false, type: "weekly_report" },
    ],
    audit_logs: [],
    profiles: [{ id: USER_A }, { id: USER_B }],
  };
  const a = fakeSupabase(tables);
  const b = fakeSupabase(tables);
  const bad = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  attachAuth(a.fake, USER_A);
  attachAuth(b.fake, USER_B);
  attachAuth(bad.fake, null);
  harness.adminClient = admin.fake;
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
  return { deps, audits, tables, a, b, admin };
}

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleMarkNotificationsRead", () => {
  it("no token → 401 and nothing flips", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleMarkNotificationsRead({ token: null, body: { all: true } }, deps);
    expect(res.status).toBe(401);
    expect(tables.notifications.every((n) => n.id === NOTE_A_READ || n.is_read === false)).toBe(true);
  });

  it("both keys → 400; neither → 400; all:false → 400; smuggled user_id → 400", async () => {
    const { deps, tables } = makeDeps();
    const both = await handleMarkNotificationsRead(
      { token: "token-a", body: { notification_id: NOTE_A1, all: true } },
      deps,
    );
    expect(both.status).toBe(400);
    expect(both.body.error).toBe("invalid_argument");
    const neither = await handleMarkNotificationsRead({ token: "token-a", body: {} }, deps);
    expect(neither.status).toBe(400);
    const falseAll = await handleMarkNotificationsRead(
      { token: "token-a", body: { all: false } },
      deps,
    );
    expect(falseAll.status).toBe(400);
    const smuggled = await handleMarkNotificationsRead(
      { token: "token-a", body: { notification_id: NOTE_A1, user_id: USER_B } },
      deps,
    );
    expect(smuggled.status).toBe(400);
    expect(String(smuggled.body.message)).toContain("user_id");
    expect(tables.notifications.find((n) => n.id === NOTE_A1)?.is_read).toBe(false);
  });

  it("one of the caller's → 200 { updated: 1 } and only that row flips", async () => {
    const { deps, audits, tables } = makeDeps();
    const res = await handleMarkNotificationsRead(
      { token: "token-a", body: { notification_id: NOTE_A1 } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    expect(tables.notifications.find((n) => n.id === NOTE_A1)?.is_read).toBe(true);
    expect(tables.notifications.find((n) => n.id === NOTE_A2)?.is_read).toBe(false);
    expect(tables.notifications.find((n) => n.id === NOTE_B)?.is_read).toBe(false);
    expect(audits.filter((e) => e.operation === "notifications_read")).toHaveLength(1);
  });

  it("another trader's id → 404 identical to a nonexistent id, nothing flips", async () => {
    const { deps, tables } = makeDeps();
    const foreign = await handleMarkNotificationsRead(
      { token: "token-a", body: { notification_id: NOTE_B } },
      deps,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "not_found" });
    const missing = await handleMarkNotificationsRead(
      { token: "token-a", body: { notification_id: "99999999-9999-4999-8999-999999999999" } },
      deps,
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(foreign.body);
    expect(tables.notifications.find((n) => n.id === NOTE_B)?.is_read).toBe(false);
  });

  it("{ all: true } → 200 { updated: 2 } — only the caller's unread rows flip", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleMarkNotificationsRead({ token: "token-a", body: { all: true } }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(tables.notifications.filter((n) => n.user_id === USER_A).every((n) => n.is_read)).toBe(true);
    expect(tables.notifications.find((n) => n.id === NOTE_B)?.is_read).toBe(false);
  });

  it("empty notification_id → the web message (400 invalid_argument per core mapping)", async () => {
    const { deps } = makeDeps();
    const res = await handleMarkNotificationsRead(
      { token: "token-a", body: { notification_id: "" } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Choose a notification first.");
  });
});
