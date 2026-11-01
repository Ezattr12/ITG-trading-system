import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { EditTradeForm } from "@/components/trades/edit-trade-form";
import { ScreenshotUploadForm } from "@/components/trades/screenshot-upload-form";
import { ConfirmButton } from "@/components/trades/confirm-button";
import { deleteScreenshotAction } from "@/lib/trades/actions";
import { getSystemStrategies, getTradeDetail } from "@/lib/trades/queries";

export const metadata = { title: "Edit trade — ITG TraderOS" };

/**
 * Edit Trade (Ezat's Edit Trade mandate): one full-form edit
 * of a saved trade — financial fields plus journal/review,
 * pre-filled from the stored trade. The save runs through
 * editTradeCore: financial changes correct by reversal (a
 * corrected trade is created, this one is marked reversed),
 * journal-only changes save in place, and every edit is
 * audited (trade.edited). Derived values are never edited —
 * they are recalculated from the source inputs.
 *
 * A reversed trade is final: the page explains and links to
 * the correcting trade instead of offering a form. A
 * cancelled trade is likewise final. Screenshots stay on
 * this trade's record (they are its evidence), so they are
 * managed here on the original trade exactly as on the
 * detail page.
 */
export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");
  if (!isSupabaseConfigured()) redirect("/trades");

  const supabase = await createServerSupabaseClient();
  const detail = await getTradeDetail(supabase, user.id, id);
  if (!detail) notFound();
  const { trade } = detail;
  const strategies = await getSystemStrategies(supabase);

  const screenshotUrls = new Map<string, string>();
  for (const shot of detail.screenshots) {
    const { data } = await supabase.storage
      .from("trade-screenshots")
      .createSignedUrl(shot.storage_path, 3600);
    if (data?.signedUrl) screenshotUrls.set(shot.id, data.signedUrl);
  }

  return (
    <AppShell email={user.email}>
      <p className="text-sm">
        <Link href={`/trades/${trade.id}`} className="itg2-link">
          ← Back to trade
        </Link>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <h1 className="itg2-page-title">Edit trade</h1>
        <span
          className={`itg2-chip itg2-chip-dir capitalize ${
            trade.direction === "long" ? "itg2-chip-profit" : "itg2-chip-loss"
          }`}
        >
          {trade.direction}
        </span>
        <span className={`itg2-chip capitalize ${trade.status === "open" ? "" : "itg2-chip-muted"}`}>
          {trade.status}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {trade.pair} · Opened {new Date(trade.opened_at).toLocaleString()}
      </p>

      {trade.status === "reversed" ? (
        <p role="status" className="itg2-notice itg2-notice-warning mt-6">
          <span>
            This trade was corrected by a reversal and is final — it can no longer be edited.{" "}
            {detail.correctingTrade ? (
              <>
                Edit the correcting trade{" "}
                <Link href={`/trades/${detail.correctingTrade.id}/edit`} className="underline">
                  here
                </Link>{" "}
                instead.
              </>
            ) : null}{" "}
            The original values are kept for the audit trail.
          </span>
        </p>
      ) : trade.status === "cancelled" ? (
        <p role="status" className="itg2-notice itg2-notice-warning mt-6">
          <span>
            A cancelled trade can no longer be edited. It stays in the journal as part of the audit
            trail.
          </span>
        </p>
      ) : (
        <>
          <div className="mt-6">
            <EditTradeForm detail={detail} strategies={strategies} />
          </div>

          <section className="motion-reveal mt-6 itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Screenshots">
            <div>
              <p className="itg2-eyebrow">Evidence</p>
              <h2 className="itg2-section-title mt-1">Screenshots</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Screenshots are this trade&apos;s evidence and stay attached to its record. If a
              financial edit corrects this trade by reversal, the screenshots remain with the
              original trade — the audit trail keeps them together.
            </p>
            {detail.screenshots.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No screenshots attached to this trade yet.</p>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {detail.screenshots.map((shot) => (
                  <li key={shot.id} className="itg2-shot">
                    <p className="break-all text-sm font-medium">{shot.file_name ?? shot.storage_path}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      OCR: {shot.ocr_status === "not_applicable" ? "not applicable — no OCR service is connected yet" : shot.ocr_status}
                      {shot.verified_by_user ? " · verified by you" : ""}
                    </p>
                    {screenshotUrls.get(shot.id) ? (
                      <div className="itg2-upload-preview mt-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={screenshotUrls.get(shot.id)} alt={`Screenshot for ${trade.pair} trade`} className="max-h-96 w-full object-contain" />
                      </div>
                    ) : (
                      <p className="mt-2 break-all text-sm text-muted-foreground">Preview unavailable — the file could not be signed. The file is stored at {shot.storage_path}.</p>
                    )}
                    <form action={deleteScreenshotAction} className="mt-3">
                      <input type="hidden" name="screenshotId" value={shot.id} />
                      <input type="hidden" name="tradeId" value={trade.id} />
                      <ConfirmButton label="Delete screenshot" confirmLabel="Click again to delete" variant="outline" />
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <ScreenshotUploadForm tradeId={trade.id} />
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
