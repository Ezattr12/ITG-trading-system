import { z } from "zod";

/**
 * Screenshot OCR — architecture only (Phase 3, spec §10).
 *
 * No OCR service is connected in v1, and no OCR extraction is
 * faked. This module defines the shape an OCR result must have
 * WHEN a service is connected (Phase 9+), and validates it the
 * same way the trade form is validated. Extracted values are
 * ALWAYS unverified until the trader reviews and confirms them
 * — they are never written to a trade automatically, and never
 * blindly trusted.
 *
 * Until a service exists, `trade_screenshots.ocr_status` stays
 * `not_applicable` and the detail page says so honestly.
 */

export const ocrExtractionSchema = z.object({
  pair: z.string().trim().min(1).max(30).optional(),
  direction: z.enum(["long", "short"]).optional(),
  entryPrice: z.number().positive().optional(),
  exitPrice: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
});

export type OcrExtraction = z.infer<typeof ocrExtractionSchema>;

export interface OcrParseResult {
  ok: boolean;
  extraction: OcrExtraction | null;
  errors: string[];
}

/** Validate a raw OCR payload. Returns the fields, or the reasons it is unusable. */
export function parseOcrExtraction(raw: unknown): OcrParseResult {
  const parsed = ocrExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      extraction: null,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, extraction: null, errors: ["OCR returned no usable fields."] };
  }
  return { ok: true, extraction: parsed.data, errors: [] };
}

/** Labels for the fields OCR may extract, for the verification UI. */
export const OCR_FIELD_LABELS: Record<keyof OcrExtraction, string> = {
  pair: "Pair",
  direction: "Long / Short",
  entryPrice: "Entry",
  exitPrice: "Exit",
  takeProfit: "Take profit",
  stopLoss: "Stop loss",
};
