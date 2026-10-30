import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile trade M2 handler tests (Phase 21): cancel +
 * screenshot upload/delete, on the same cores the web
 * actions use. Storage is a recording stub attached to
 * each user fake (the profile-service test pattern).
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

import {
  handleCancelTrade,
  handleDeleteScreenshot,
  handleUploadScreenshot,
} from "./trades";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRADE_OPEN_A = "11111111-1111-4111-8111-111111111111";
const TRADE_CLOSED_A = "22222222-2222-4222-8222-222222222222";
const TRADE_OPEN_B = "33333333-3333-4333-8333-333333333333";
const SHOT_A = "44444444-4444-4444-8444-444444444444";
const SHOT_B = "55555555-5555-4555-8555-555555555555";
const MISSING = "99999999-9999-4999-8999-999999999999";

function attachAuth(fake: unknown, userId: string | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

interface StorageCall {
  op: "upload" | "remove";
  bucket: string;
  path: string;
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    trades: [
      { id: TRADE_OPEN_A, user_id: USER_A, status: "open", pair: "XAUUSD" },
      { id: TRADE_CLOSED_A, user_id: USER_A, status: "closed", pair: "XAUUSD", pnl: 10 },
      { id: TRADE_OPEN_B, user_id: USER_B, status: "open", pair: "EURUSD" },
    ],
    trade_screenshots: [
      {
        id: SHOT_A,
        trade_id: TRADE_OPEN_A,
        user_id: USER_A,
        storage_path: `${USER_A}/${TRADE_OPEN_A}/1-chart.png`,
        file_name: "chart.png",
      },
      {
        id: SHOT_B,
        trade_id: TRADE_OPEN_B,
        user_id: USER_B,
        storage_path: `${USER_B}/${TRADE_OPEN_B}/1-chart.png`,
        file_name: "chart.png",
      },
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
  const storageCalls: StorageCall[] = [];
  for (const userFake of [a, b]) {
    (userFake.fake as unknown as { storage: unknown }).storage = {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          storageCalls.push({ op: "upload", bucket, path });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const path of paths) storageCalls.push({ op: "remove", bucket, path });
          return { error: null };
        },
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
  return { deps, audits, tables, a, b, admin, storageCalls };
}

function pngFile(name = "chart.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleCancelTrade", () => {
  it("no token → 401, trade untouched", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleCancelTrade({ token: null, body: {}, tradeId: TRADE_OPEN_A }, deps);
    expect(res.status).toBe(401);
    expect(tables.trades.find((t) => t.id === TRADE_OPEN_A)?.status).toBe("open");
  });

  it("smuggled user_id in body → 400 naming it, no cancel", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleCancelTrade(
      { token: "token-a", body: { user_id: USER_B }, tradeId: TRADE_OPEN_A },
      deps,
    );
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("user_id");
    expect(tables.trades.find((t) => t.id === TRADE_OPEN_A)?.status).toBe("open");
  });

  it("non-UUID trade id → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleCancelTrade({ token: "token-a", body: {}, tradeId: "nope" }, deps);
    expect(res.status).toBe(400);
  });

  it("open trade → 200 { trade_id, status: cancelled }, row updated, both audit rows written", async () => {
    const { deps, audits, tables, admin } = makeDeps();
    const res = await handleCancelTrade(
      { token: "token-a", body: null, tradeId: TRADE_OPEN_A },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trade_id: TRADE_OPEN_A, status: "cancelled" });
    expect(tables.trades.find((t) => t.id === TRADE_OPEN_A)?.status).toBe("cancelled");
    expect(admin.fake.insertsFor("audit_logs").map((r) => r.action)).toContain("trade.cancelled");
    expect(audits.filter((e) => e.operation === "trade_cancelled")).toHaveLength(1);
  });

  it("closed trade → 422 with the reversal-not-cancellation rule, status unchanged", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleCancelTrade(
      { token: "token-a", body: {}, tradeId: TRADE_CLOSED_A },
      deps,
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.message).toBe(
      "Only an open trade can be cancelled — a closed trade is corrected by reversal, never cancelled.",
    );
    expect(tables.trades.find((t) => t.id === TRADE_CLOSED_A)?.status).toBe("closed");
  });

  it("another trader's open trade → 404 identical to missing, still open", async () => {
    const { deps, tables } = makeDeps();
    const foreign = await handleCancelTrade(
      { token: "token-a", body: {}, tradeId: TRADE_OPEN_B },
      deps,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "not_found" });
    const missing = await handleCancelTrade({ token: "token-a", body: {}, tradeId: MISSING }, deps);
    expect(missing.body).toEqual(foreign.body);
    expect(tables.trades.find((t) => t.id === TRADE_OPEN_B)?.status).toBe("open");
  });
});

describe("handleUploadScreenshot", () => {
  it("no token → 401, nothing stored", async () => {
    const { deps, storageCalls, tables } = makeDeps();
    const res = await handleUploadScreenshot(
      { token: null, tradeId: TRADE_OPEN_A, file: pngFile() },
      deps,
    );
    expect(res.status).toBe(401);
    expect(storageCalls).toHaveLength(0);
    expect(tables.trade_screenshots).toHaveLength(2);
  });

  it("happy path → 201 { screenshot_id }, private bucket + per-user path, row linked, audits written", async () => {
    const { deps, audits, tables, a, admin, storageCalls } = makeDeps();
    const res = await handleUploadScreenshot(
      { token: "token-a", tradeId: TRADE_OPEN_A, file: pngFile() },
      deps,
    );
    expect(res.status).toBe(201);
    const shotId = res.body.screenshot_id as string;
    expect(typeof shotId).toBe("string");
    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0].bucket).toBe("trade-screenshots");
    expect(storageCalls[0].path.startsWith(`${USER_A}/${TRADE_OPEN_A}/`)).toBe(true);
    expect(storageCalls[0].path.endsWith("-chart.png")).toBe(true);
    const rows = a.fake.insertsFor("trade_screenshots");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: shotId,
      trade_id: TRADE_OPEN_A,
      user_id: USER_A,
      ocr_status: "not_applicable",
      verified_by_user: false,
    });
    expect(admin.fake.insertsFor("audit_logs").map((r) => r.action)).toContain("trade.screenshot_uploaded");
    expect(audits.filter((e) => e.operation === "trade_screenshot_uploaded")).toHaveLength(1);
    expect(tables.trade_screenshots).toHaveLength(3);
  });

  it("no file → 400 with the web message; non-image → 400 with the web message", async () => {
    const { deps, storageCalls } = makeDeps();
    const noFile = await handleUploadScreenshot(
      { token: "token-a", tradeId: TRADE_OPEN_A, file: null },
      deps,
    );
    expect(noFile.status).toBe(400);
    expect(noFile.body.message).toBe("Choose an image file first.");
    const text = await handleUploadScreenshot(
      {
        token: "token-a",
        tradeId: TRADE_OPEN_A,
        file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      },
      deps,
    );
    expect(text.status).toBe(400);
    expect(text.body.message).toBe("Only image files can be uploaded as screenshots.");
    expect(storageCalls).toHaveLength(0);
  });

  it("another trader's trade → 404, nothing stored", async () => {
    const { deps, storageCalls, tables } = makeDeps();
    const res = await handleUploadScreenshot(
      { token: "token-a", tradeId: TRADE_OPEN_B, file: pngFile() },
      deps,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(storageCalls).toHaveLength(0);
    expect(tables.trade_screenshots).toHaveLength(2);
  });

  it("unreadable multipart (formError) → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleUploadScreenshot(
      { token: "token-a", tradeId: TRADE_OPEN_A, file: null, formError: "request body must be multipart form data with a 'file' field" },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
  });
});

describe("handleDeleteScreenshot", () => {
  it("own screenshot → 200 { ok: true }, storage object removed, row deleted", async () => {
    const { deps, audits, tables, a, storageCalls } = makeDeps();
    const res = await handleDeleteScreenshot(
      { token: "token-a", tradeId: TRADE_OPEN_A, screenshotId: SHOT_A },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(storageCalls).toEqual([
      { op: "remove", bucket: "trade-screenshots", path: `${USER_A}/${TRADE_OPEN_A}/1-chart.png` },
    ]);
    expect(a.fake.deletesFor("trade_screenshots").map((r) => r.id)).toEqual([SHOT_A]);
    expect(tables.trade_screenshots.some((s) => s.id === SHOT_A)).toBe(false);
    expect(audits.filter((e) => e.operation === "trade_screenshot_deleted")).toHaveLength(1);
  });

  it("another trader's screenshot id → 404 identical to missing, row and object intact", async () => {
    const { deps, tables, storageCalls } = makeDeps();
    const foreign = await handleDeleteScreenshot(
      { token: "token-a", tradeId: TRADE_OPEN_B, screenshotId: SHOT_B },
      deps,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "not_found" });
    const missing = await handleDeleteScreenshot(
      { token: "token-a", tradeId: TRADE_OPEN_A, screenshotId: MISSING },
      deps,
    );
    expect(missing.body).toEqual(foreign.body);
    expect(tables.trade_screenshots.some((s) => s.id === SHOT_B)).toBe(true);
    expect(storageCalls).toHaveLength(0);
  });

  it("own screenshot under a different trade path → 404, row intact (nested resource semantics)", async () => {
    const { deps, tables, storageCalls } = makeDeps();
    const res = await handleDeleteScreenshot(
      { token: "token-a", tradeId: TRADE_CLOSED_A, screenshotId: SHOT_A },
      deps,
    );
    expect(res.status).toBe(404);
    expect(tables.trade_screenshots.some((s) => s.id === SHOT_A)).toBe(true);
    expect(storageCalls).toHaveLength(0);
  });

  it("non-UUID ids → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleDeleteScreenshot(
      { token: "token-a", tradeId: "nope", screenshotId: SHOT_A },
      deps,
    );
    expect(res.status).toBe(400);
  });
});
