import { describe, expect, it, vi } from "vitest";
import {
  SCREENSHOT_MAX_BYTES,
  submitTradeWithScreenshot,
  tradeIdFromRedirect,
  validateScreenshotFile,
  withShotFailed,
} from "@/components/trades/attach-screenshot";
import type { TradeActionResult } from "./actions";

/**
 * Screenshot attach-at-create (Master Web UI Redesign,
 * Page 2). The orchestration lives in
 * components/trades/attach-screenshot.ts; these tests pin
 * its contract: the create payload never carries the file,
 * the upload only runs after a successful create with a
 * picked screenshot, and an upload failure never fails the
 * trade — it only flags the redirect with `shot=failed`.
 */

const TRADE_ID = "3f6b0f5e-9d4d-4b1e-9d3a-2f5f0a1b2c3d";
const CREATED: TradeActionResult = { ok: true, redirectTo: `/trades/${TRADE_ID}?saved=1` };

function png(size = 1024): File {
  return new File([new Uint8Array(size)], "chart.png", { type: "image/png" });
}

function tradeFormData(file: File | null): FormData {
  const data = new FormData();
  data.set("pair", "EUR/USD");
  data.set("direction", "long");
  if (file) data.set("screenshot", file);
  return data;
}

describe("validateScreenshotFile — mirrors the server upload checks", () => {
  it("requires a file", () => {
    expect(validateScreenshotFile(null)).toBe("Choose an image file first.");
    expect(validateScreenshotFile({ type: "image/png", size: 0 })).toBe(
      "Choose an image file first.",
    );
  });

  it("rejects non-images with the server's message", () => {
    expect(validateScreenshotFile({ type: "application/pdf", size: 100 })).toBe(
      "Only image files can be uploaded as screenshots.",
    );
    expect(validateScreenshotFile({ type: "text/plain", size: 100 })).toBe(
      "Only image files can be uploaded as screenshots.",
    );
  });

  it("rejects files over 5 MB with the server's message", () => {
    expect(validateScreenshotFile({ type: "image/png", size: SCREENSHOT_MAX_BYTES + 1 })).toBe(
      "Screenshot must be 5 MB or smaller.",
    );
  });

  it("accepts an image of exactly 5 MB and smaller images", () => {
    expect(validateScreenshotFile({ type: "image/png", size: SCREENSHOT_MAX_BYTES })).toBeNull();
    expect(validateScreenshotFile({ type: "image/jpeg", size: 42 })).toBeNull();
  });
});

describe("tradeIdFromRedirect", () => {
  it("reads the id out of the create redirect", () => {
    expect(tradeIdFromRedirect(`/trades/${TRADE_ID}?saved=1`)).toBe(TRADE_ID);
    expect(tradeIdFromRedirect(`/trades/${TRADE_ID}`)).toBe(TRADE_ID);
  });

  it("returns null for anything that is not a trade page", () => {
    expect(tradeIdFromRedirect("/trades")).toBeNull();
    expect(tradeIdFromRedirect("/dashboard")).toBeNull();
    expect(tradeIdFromRedirect(`/trades/${TRADE_ID}/edit`)).toBeNull();
    expect(tradeIdFromRedirect("")).toBeNull();
  });
});

describe("withShotFailed", () => {
  it("appends with & when a query string exists", () => {
    expect(withShotFailed(`/trades/${TRADE_ID}?saved=1`)).toBe(
      `/trades/${TRADE_ID}?saved=1&shot=failed`,
    );
  });

  it("appends with ? when there is no query string", () => {
    expect(withShotFailed(`/trades/${TRADE_ID}`)).toBe(`/trades/${TRADE_ID}?shot=failed`);
  });
});

describe("submitTradeWithScreenshot", () => {
  it("passes a failed create straight back and never uploads", async () => {
    const create = vi.fn(async () => ({ ok: false, error: "Please check the form." }));
    const upload = vi.fn(async () => ({ ok: true }));
    const result = await submitTradeWithScreenshot(
      create,
      upload,
      { ok: false },
      tradeFormData(png()),
      png(),
    );
    expect(result).toEqual({ ok: false, error: "Please check the form." });
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the screenshot from the create payload", async () => {
    let seenByCreate: FormData | null = null;
    const create = vi.fn(async (_prev: TradeActionResult, data: FormData) => {
      seenByCreate = data;
      return CREATED;
    });
    const upload = vi.fn(async () => ({ ok: true, message: "Screenshot uploaded." }));
    await submitTradeWithScreenshot(create, upload, { ok: false }, tradeFormData(png()), png());
    expect(seenByCreate!.get("screenshot")).toBeNull();
    expect(seenByCreate!.get("pair")).toBe("EUR/USD");
  });

  it("with no screenshot picked, returns the create result untouched and never uploads", async () => {
    const create = vi.fn(async () => CREATED);
    const upload = vi.fn(async () => ({ ok: true }));
    const result = await submitTradeWithScreenshot(
      create,
      upload,
      { ok: false },
      tradeFormData(null),
      null,
    );
    expect(result).toBe(CREATED);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads for the created trade's id and keeps the original redirect on success", async () => {
    const create = vi.fn(async () => CREATED);
    let uploadData: FormData | null = null;
    const upload = vi.fn(async (_prev: TradeActionResult, data: FormData) => {
      uploadData = data;
      return { ok: true, message: "Screenshot uploaded." };
    });
    const file = png();
    const result = await submitTradeWithScreenshot(
      create,
      upload,
      { ok: false },
      tradeFormData(file),
      file,
    );
    expect(result).toBe(CREATED);
    expect(uploadData!.get("tradeId")).toBe(TRADE_ID);
    expect(uploadData!.get("screenshot")).toBe(file);
  });

  it("on upload failure the trade still succeeds — only the redirect gains shot=failed", async () => {
    const create = vi.fn(async () => CREATED);
    const upload = vi.fn(async () => ({ ok: false, error: "Screenshot upload failed." }));
    const result = await submitTradeWithScreenshot(
      create,
      upload,
      { ok: false },
      tradeFormData(png()),
      png(),
    );
    expect(result.ok).toBe(true);
    expect(result.redirectTo).toBe(`/trades/${TRADE_ID}?saved=1&shot=failed`);
  });

  it("treats a throwing upload action as a failed upload, not a failed trade", async () => {
    const create = vi.fn(async () => CREATED);
    const upload = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await submitTradeWithScreenshot(
      create,
      upload,
      { ok: false },
      tradeFormData(png()),
      png(),
    );
    expect(result.ok).toBe(true);
    expect(result.redirectTo).toBe(`/trades/${TRADE_ID}?saved=1&shot=failed`);
  });
});
