import type { TradeActionResult } from "@/lib/trades/actions";

/**
 * Screenshot attach-at-create (Master Web UI Redesign,
 * Page 2 — Add Trade; the mobile app already had this).
 *
 * The trade is created through the EXISTING create action
 * with the exact same payload as before: the `screenshot`
 * entry is removed from the form data first, so the create
 * contract is untouched. Only after the create succeeds —
 * and only when the trader picked a screenshot — is the
 * file uploaded through the EXISTING upload action (same
 * private `trade-screenshots` bucket, same audit row) for
 * the new trade's id, which the create action returns
 * inside its `redirectTo` (`/trades/<id>?saved=1`).
 *
 * The screenshot NEVER blocks the trade: an upload failure
 * (or an unexpected throw) still lands on the trade page,
 * with `shot=failed` added to the redirect so the page can
 * show an honest "trade saved, screenshot not attached"
 * notice — the same pattern the mobile app uses.
 */

export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Client-side mirror of the validation in
 * uploadScreenshotAction / uploadScreenshotCore (same
 * limits, same messages) so a bad pick is rejected before
 * saving. The server action re-checks everything and stays
 * authoritative.
 */
export function validateScreenshotFile(
  file: { type: string; size: number } | null,
): string | null {
  if (!file || file.size === 0) return "Choose an image file first.";
  if (!file.type.startsWith("image/")) {
    return "Only image files can be uploaded as screenshots.";
  }
  if (file.size > SCREENSHOT_MAX_BYTES) {
    return "Screenshot must be 5 MB or smaller.";
  }
  return null;
}

/** The created trade's id out of a `/trades/<id>...` redirect. */
export function tradeIdFromRedirect(redirectTo: string): string | null {
  const parts = redirectTo.split(/[?#]/)[0].split("/").filter(Boolean);
  return parts.length === 2 && parts[0] === "trades" ? parts[1] : null;
}

/** Append the screenshot-failure flag to a redirect target. */
export function withShotFailed(redirectTo: string): string {
  return `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}shot=failed`;
}

type TradeAction = (
  prev: TradeActionResult,
  formData: FormData,
) => Promise<TradeActionResult>;

/**
 * Create the trade, then attach the picked screenshot.
 * Returns the create result unchanged in every case except
 * a failed upload after a successful create, where only
 * the redirect gains `shot=failed`.
 */
export async function submitTradeWithScreenshot(
  createAction: TradeAction,
  uploadAction: TradeAction,
  prev: TradeActionResult,
  formData: FormData,
  file: File | null,
): Promise<TradeActionResult> {
  // The create payload stays byte-identical to the
  // no-screenshot submit: the file travels separately.
  formData.delete("screenshot");
  const result = await createAction(prev, formData);
  if (!result.ok || !result.redirectTo || !file) return result;
  const tradeId = tradeIdFromRedirect(result.redirectTo);
  if (!tradeId) return result;
  const uploadData = new FormData();
  uploadData.set("tradeId", tradeId);
  uploadData.set("screenshot", file);
  let upload: TradeActionResult;
  try {
    upload = await uploadAction({ ok: false }, uploadData);
  } catch {
    // A transport-level failure is still just a failed
    // upload: the trade is saved, the screenshot is not.
    return { ...result, redirectTo: withShotFailed(result.redirectTo) };
  }
  return upload.ok
    ? result
    : { ...result, redirectTo: withShotFailed(result.redirectTo) };
}
