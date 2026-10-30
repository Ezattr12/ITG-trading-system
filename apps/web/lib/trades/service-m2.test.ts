import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";

/**
 * Trade M2 core tests (Phase 21): cancel / screenshot
 * cores extracted from the web actions. Validation ORDER
 * is part of the contract (the web form's messages depend
 * on it): file checks → upload rate limit → trade lookup.
 * Storage is a recording stub on the user fake.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("cores receive their client explicitly");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import {
  cancelTradeCore,
  deleteScreenshotCore,
  uploadScreenshotCore,
} from "./service";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPEN_A = "11111111-1111-4111-8111-111111111111";
const CLOSED_A = "22222222-2222-4222-8222-222222222222";
const SHOT = "44444444-4444-4444-8444-444444444444";

function setup() {
  const tables: Record<string, Row[]> = {
    trades: [
      { id: OPEN_A, user_id: USER_A, status: "open" },
      { id: CLOSED_A, user_id: USER_A, status: "closed", pnl: 5 },
    ],
    trade_screenshots: [
      {
        id: SHOT,
        trade_id: OPEN_A,
        user_id: USER_A,
        storage_path: `${USER_A}/${OPEN_A}/1-a.png`,
      },
    ],
    audit_logs: [],
    profiles: [{ id: USER_A }, { id: USER_B }],
    ai_insights: [],
  };
  const user = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  harness.adminClient = admin.fake;
  const storageCalls: { op: string; bucket: string; path: string }[] = [];
  (user.fake as unknown as { storage: unknown }).storage = {
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
  return { user, admin, tables, storageCalls };
}

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("cancelTradeCore", () => {
  it("open trade → cancelled + trade.cancelled audit", async () => {
    const { user, admin, tables } = setup();
    const res = await cancelTradeCore(user.client, USER_A, OPEN_A);
    expect(res).toEqual({ ok: true, tradeId: OPEN_A, status: "cancelled" });
    expect(tables.trades.find((t) => t.id === OPEN_A)?.status).toBe("cancelled");
    expect(admin.fake.insertsFor("audit_logs").map((r) => r.action)).toContain("trade.cancelled");
  });

  it("closed trade → business failure with the exact rule message", async () => {
    const { user } = setup();
    const res = await cancelTradeCore(user.client, USER_A, CLOSED_A);
    expect(res).toEqual({
      ok: false,
      code: "business",
      error: "Only an open trade can be cancelled — a closed trade is corrected by reversal, never cancelled.",
    });
  });

  it("missing/other's trade → not_found (indistinguishable)", async () => {
    const { user } = setup();
    const missing = await cancelTradeCore(user.client, USER_A, "99999999-9999-4999-8999-999999999999");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("not_found");
    const foreign = await cancelTradeCore(user.client, USER_B, OPEN_A);
    expect(foreign).toEqual(missing);
  });
});

describe("uploadScreenshotCore", () => {
  it("validation order: file problems surface before the trade lookup", async () => {
    const { user } = setup();
    const missingTrade = "99999999-9999-4999-8999-999999999999";
    const noFile = await uploadScreenshotCore(user.client, USER_A, missingTrade, null);
    expect(noFile).toEqual({ ok: false, code: "invalid_input", error: "Choose an image file first." });
    const textFile = await uploadScreenshotCore(
      user.client,
      USER_A,
      missingTrade,
      new File(["x"], "a.txt", { type: "text/plain" }),
    );
    expect(textFile).toEqual({
      ok: false,
      code: "invalid_input",
      error: "Only image files can be uploaded as screenshots.",
    });
    const goodFileMissingTrade = await uploadScreenshotCore(
      user.client,
      USER_A,
      missingTrade,
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
    );
    expect(goodFileMissingTrade.ok).toBe(false);
    if (!goodFileMissingTrade.ok) expect(goodFileMissingTrade.code).toBe("not_found");
  });

  it("oversize image → the 5 MB message", async () => {
    const { user, storageCalls } = setup();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const res = await uploadScreenshotCore(user.client, USER_A, OPEN_A, big);
    expect(res).toEqual({
      ok: false,
      code: "invalid_input",
      error: "Screenshot must be 5 MB or smaller.",
    });
    expect(storageCalls).toHaveLength(0);
  });

  it("filename is sanitised in the storage path", async () => {
    const { user, storageCalls } = setup();
    const res = await uploadScreenshotCore(
      user.client,
      USER_A,
      OPEN_A,
      new File([new Uint8Array([1])], "my chart (final).png", { type: "image/png" }),
    );
    expect(res.ok).toBe(true);
    expect(storageCalls[0].path).toContain("my_chart__final_.png");
    expect(storageCalls[0].path.startsWith(`${USER_A}/${OPEN_A}/`)).toBe(true);
  });
});

describe("deleteScreenshotCore", () => {
  it("without an expected trade (the web path) the owner's row deletes by id alone", async () => {
    const { user, admin, tables, storageCalls } = setup();
    const res = await deleteScreenshotCore(user.client, USER_A, SHOT);
    expect(res).toEqual({ ok: true, screenshotId: SHOT });
    expect(tables.trade_screenshots).toHaveLength(0);
    expect(storageCalls).toEqual([
      { op: "remove", bucket: "trade-screenshots", path: `${USER_A}/${OPEN_A}/1-a.png` },
    ]);
    // Phase 27: the destructive delete writes an audit row,
    // mirroring trade.screenshot_uploaded on the upload path.
    const audit = admin.fake.insertsFor("audit_logs");
    expect(
      audit.some((r) => r.action === "trade.screenshot_deleted" && r.entity_id === SHOT),
    ).toBe(true);
  });

  it("with a mismatched expected trade → not_found, nothing removed", async () => {
    const { user, tables, storageCalls } = setup();
    const res = await deleteScreenshotCore(user.client, USER_A, SHOT, CLOSED_A);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
    expect(tables.trade_screenshots).toHaveLength(1);
    expect(storageCalls).toHaveLength(0);
  });
});
