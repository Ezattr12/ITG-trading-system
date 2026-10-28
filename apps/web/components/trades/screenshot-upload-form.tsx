"use client";

import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadScreenshotAction, type TradeActionResult } from "@/lib/trades/actions";

/**
 * Screenshot upload (Phase 3, spec §10). Real Supabase Storage
 * when configured; an honest error otherwise. Images only,
 * 5 MB max. No OCR is run on upload — OCR status stays
 * `not_applicable` until an OCR service is connected.
 */
export function ScreenshotUploadForm({ tradeId }: { tradeId: string }) {
  return (
    <ActionForm
      action={uploadScreenshotAction as (prev: TradeActionResult, formData: FormData) => Promise<TradeActionResult>}
      submitLabel="Upload screenshot"
    >
      <input type="hidden" name="tradeId" value={tradeId} />
      <div className="space-y-2">
        <Label htmlFor="screenshot">Screenshot (image, max 5 MB)</Label>
        <Input id="screenshot" name="screenshot" type="file" accept="image/*" required className="min-h-[44px]" />
      </div>
      <p className="text-xs text-muted-foreground">
        Screenshots are stored in Supabase Storage and attached to this trade. No automatic text extraction runs
        yet — when an OCR service is connected, extracted values will appear here for you to verify first.
      </p>
    </ActionForm>
  );
}
