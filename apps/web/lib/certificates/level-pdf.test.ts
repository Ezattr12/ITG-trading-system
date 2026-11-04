import { describe, expect, it } from "vitest";
import { buildLevelCertificatePdf } from "./pdf";

/**
 * Level certificate PDF smoke test (Task 24). Like the monthly
 * PDF test: PDFKit output is binary, so this checks the
 * document is a real, non-empty PDF — the content is covered by
 * the issuance and verification unit tests, not by parsing the
 * PDF back.
 */
describe("buildLevelCertificatePdf", () => {
  it("produces a non-empty PDF document", async () => {
    const pdf = await buildLevelCertificatePdf({
      traderName: "Test Trader",
      certificateId: "ITG-202611-DEF456",
      levelName: "Strategy Operator",
      assessedAt: "2026-11-03T10:00:00Z",
      score: 59.2,
      issuedAt: "2026-11-04T12:00:00Z",
    });
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
