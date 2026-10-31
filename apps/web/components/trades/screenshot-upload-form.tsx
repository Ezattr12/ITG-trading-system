"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadScreenshotAction, type TradeActionResult } from "@/lib/trades/actions";

/**
 * Screenshot upload (Phase 3, spec §10). Real Supabase Storage
 * when configured; an honest error otherwise. Images only,
 * 5 MB max. No OCR is run on upload — OCR status stays
 * `not_applicable` until an OCR service is connected.
 *
 * Master Web UI Redesign Page 4: the picker renders as the
 * Page 2 `.itg2-upload` dropzone — the real file input sits
 * transparent over the zone (still rendered and focusable,
 * so the native `required` validation keeps working; the
 * zone's :focus-within ring carries keyboard focus) and a
 * picked file's name replaces the prompt, mirroring Add
 * Trade's selection feedback. The field name, accept rule,
 * required flag, action and submit behaviour are unchanged;
 * the submit uses `.itg2-btn-primary` via ActionForm's
 * submitClassName, like every v2 form. Used only by the
 * trade detail page.
 */
export function ScreenshotUploadForm({ tradeId }: { tradeId: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <ActionForm
      action={uploadScreenshotAction as (prev: TradeActionResult, formData: FormData) => Promise<TradeActionResult>}
      submitLabel="Upload screenshot"
      submitClassName="itg2-btn-primary itg2-btn-save"
    >
      <input type="hidden" name="tradeId" value={tradeId} />
      <div className="space-y-2">
        <Label htmlFor="screenshot" className="itg2-label">
          Screenshot (image, max 5 MB)
        </Label>
        <label className="itg2-upload relative">
          <Input
            id="screenshot"
            name="screenshot"
            type="file"
            accept="image/*"
            required
            className="absolute inset-0 h-full min-h-0 w-full cursor-pointer opacity-0"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          />
          <ImagePlus className="h-6 w-6" aria-hidden="true" />
          <span className="max-w-full truncate text-sm font-semibold text-[var(--itg-text-primary)]">
            {fileName ?? "Attach a screenshot"}
          </span>
          <span className="text-xs text-muted-foreground">
            {fileName ? "Click to choose a different image." : "Click to choose an image — uploaded when you submit."}
          </span>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Screenshots are stored in Supabase Storage and attached to this trade. No automatic text extraction runs
        yet — when an OCR service is connected, extracted values will appear here for you to verify first.
      </p>
    </ActionForm>
  );
}
