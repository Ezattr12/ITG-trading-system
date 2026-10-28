import { describe, expect, it } from "vitest";
import { buildCertificatePdf } from "./pdf";
import { buildReportPdf } from "../reports/pdf";
import { buildReportSummary } from "../reports/reports";

/**
 * PDF smoke tests (Phase 8). PDFKit output is binary, so these
 * check the document is a real, non-empty PDF with the expected
 * shape — the content is covered by the eligibility and report
 * unit tests, not by parsing the PDF back.
 */
describe("buildCertificatePdf", () => {
  it("produces a non-empty PDF document", async () => {
    const pdf = await buildCertificatePdf({
      traderName: "Test Trader",
      certificateId: "ITG-202610-ABC123",
      monthLabel: "October 2026",
      criteria: [
        { key: "journaling", label: "Consistent journaling", met: true, detail: "18 of 20 trades journaled (90%)" },
        { key: "risk_discipline", label: "Risk discipline", met: true, detail: "95% of trades disciplined" },
        { key: "routine", label: "Trading routine", met: true, detail: "12 active days across 4 weeks" },
        { key: "review", label: "Performance review", met: true, detail: "2 completed weekly reviews" },
      ],
      issuedAt: "2026-10-27T00:00:00Z",
    });
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});

describe("buildReportPdf", () => {
  it("produces a non-empty PDF document from a real summary", async () => {
    const summary = buildReportSummary({
      type: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      trades: [
        { id: "1", pair: "EURUSD", direction: "long", session: "london", strategyName: "FVG", pnl: 100, rMultiple: 1, closedAt: "2026-10-10T10:00:00Z", emotion: "calm", discipline: "good", journaled: true, stopLossSet: true },
        { id: "2", pair: "EURUSD", direction: "long", session: "london", strategyName: "FVG", pnl: -50, rMultiple: -0.5, closedAt: "2026-10-11T10:00:00Z", emotion: "fear", discipline: "good", journaled: true, stopLossSet: true },
      ],
      lessons: [],
      goalsCompleted: 1,
      goalsTotal: 2,
    });
    const pdf = await buildReportPdf(summary, "Test Trader");
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
