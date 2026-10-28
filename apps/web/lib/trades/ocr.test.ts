import { describe, expect, it } from "vitest";
import { parseOcrExtraction } from "./ocr";

describe("parseOcrExtraction — never blindly trust OCR (spec §10)", () => {
  it("accepts a partial extraction", () => {
    const r = parseOcrExtraction({ pair: "EUR/USD", direction: "long", entryPrice: 1.1 });
    expect(r.ok).toBe(true);
    expect(r.extraction).toEqual({ pair: "EUR/USD", direction: "long", entryPrice: 1.1 });
  });
  it("rejects a negative price", () => {
    const r = parseOcrExtraction({ entryPrice: -1 });
    expect(r.ok).toBe(false);
    expect(r.extraction).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it("rejects an empty extraction — nothing to verify", () => {
    expect(parseOcrExtraction({}).ok).toBe(false);
    expect(parseOcrExtraction(null).ok).toBe(false);
    expect(parseOcrExtraction("not json").ok).toBe(false);
  });
  it("rejects an invalid direction", () => {
    expect(parseOcrExtraction({ direction: "sideways" }).ok).toBe(false);
  });
});
