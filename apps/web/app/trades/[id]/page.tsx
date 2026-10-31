import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { QuickTradeForm } from "@/components/trades/quick-trade-form";
import { AdvancedReviewForm } from "@/components/trades/advanced-review-form";
import { ScreenshotUploadForm } from "@/components/trades/screenshot-upload-form";
import { TradeSavedBanner } from "@/components/trades/trade-saved-banner";
import { ConfirmButton } from "@/components/trades/confirm-button";
import {
  cancelTradeAction,
  correctTradeAction,
  deleteScreenshotAction,
} from "@/lib/trades/actions";
import { getSystemStrategies, getTradeDetail, getTradeListItems } from "@/lib/trades/queries";
import { formatDuration, formatMoney } from "@/lib/trades/calculations";
import { mostRepeatedLesson } from "@/lib/trades/lessons";
import {
  DISCIPLINE_LABELS,
  EMOTION_LABELS,
  MARKET_CONDITION_LABELS,
  SESSION_LABELS,
  TRADE_REASON_LABELS,
} from "@/lib/trades/validation";

export const metadata = { title: "Trade — ITG TraderOS" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tnum">{value}</dd>
    </div>
  );
}

function orDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/**
 * Trade detail / review (Phase 3, spec §33): screenshot(s),
 * trade data, performance, strategy, risk, psychology, notes,
 * lesson, AI insight, related trades.
 *
 * AI insight is honestly unavailable until Phase 9 — the
 * section says so instead of showing a fabricated insight.
 * Corrections create a reversing trade; only an open trade
 * can be cancelled. Closed trades are never deleted.
 */
export default async function TradeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; shot?: string }>;
}) {
  const { id } = await params;
  const { saved, shot } = await searchParams;
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

  const related = (await getTradeListItems(supabase, user.id, { pair: trade.pair }))
    .filter((item) => item.trade.id !== trade.id)
    .slice(0, 5);

  const { data: allLessons } = await supabase
    .from("lessons")
    .select("id, trade_id, text, created_at")
    .eq("user_id", user.id);
  const repeated = mostRepeatedLesson(
    ((allLessons ?? []) as { id: string; trade_id: string | null; text: string; created_at: string }[]).map(
      (l) => ({ id: l.id, tradeId: l.trade_id, text: l.text, createdAt: l.created_at }),
    ),
  );

  const editable = trade.status === "open" || trade.status === "closed";

  return (
    <AppShell email={user.email}>
        <p className="text-sm">
          <Link href="/trades" className="text-muted-foreground underline">
            ← Back to trades
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="page-title">
            {trade.pair} · <span className="capitalize">{trade.direction}</span>
          </h1>
          <span className="rounded-full border px-3 py-1 text-xs capitalize shadow-elevation-1">{trade.status}</span>
          {trade.is_win === true && <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400 shadow-elevation-1">Win</span>}
          {trade.is_win === false && <span className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-400 shadow-elevation-1">Loss</span>}
        </div>
        <p className="page-lede">
          Opened {new Date(trade.opened_at).toLocaleString()}
          {trade.closed_at ? ` · Closed ${new Date(trade.closed_at).toLocaleString()}` : " · Still open"}
        </p>

        {/* Shown after a save or correction (?saved=1, Phase 16):
            an animated checkmark confirmation, dismissible. */}
        {saved === "1" ? <TradeSavedBanner /> : null}

        {/* Shown when a trade saved from Add Trade but its
            attach-at-create screenshot upload failed
            (?shot=failed, Master Redesign Page 2 — the same
            pattern as mobile). The trade itself is saved; the
            Screenshots section below is the retry path. */}
        {shot === "failed" ? (
          <p role="status" className="motion-fade-in mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <strong>Screenshot not attached.</strong> Your trade was saved, but the screenshot upload
            failed — you can add it below in the Screenshots section.
          </p>
        ) : null}

        {trade.status === "reversed" && detail.correctingTrade && (
          <p role="status" className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            This trade was corrected. The correcting trade is{" "}
            <Link href={`/trades/${detail.correctingTrade.id}`} className="underline">
              here
            </Link>
            . The original values are kept for the audit trail.
          </p>
        )}
        {detail.reversedTrade && (
          <p role="status" className="mt-4 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            This trade corrects{" "}
            <Link href={`/trades/${detail.reversedTrade.id}`} className="underline">
              {detail.reversedTrade.pair} (reversed)
            </Link>
            .
          </p>
        )}

        {/* Trade result hero (Phase 18): the real outcome first —
            large tabular P&L and R, with a semantic glow driven by
            the real result — emerald for a win, red for a loss,
            calm blue while the trade is still open. The remaining
            facts (risk/reward, duration, leverage) sit below in
            smaller stat cards; no value is dropped. */}
        <section
          className={`hero-card mt-6 card-surface-raised p-4 sm:p-6 ${
            trade.is_win === true
              ? "card-glow-emerald"
              : trade.is_win === false
                ? "card-glow-danger"
                : "card-glow-blue"
          }`}
          aria-label="Trade result"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="eyebrow">Trade result</h2>
              <p
                className={`metric-hero mt-1 tnum ${
                  trade.pnl === null ? "" : trade.pnl > 0 ? "text-emerald-400" : trade.pnl < 0 ? "text-red-400" : ""
                }`}
              >
                {trade.status === "open" ? "Open" : formatMoney(trade.pnl)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {trade.status === "open"
                  ? "Still open — P&L is calculated when the trade closes."
                  : trade.is_win === true
                    ? "Winning trade"
                    : trade.is_win === false
                      ? "Losing trade"
                      : "Closed trade"}
                {trade.closed_at ? ` · Closed ${new Date(trade.closed_at).toLocaleDateString()}` : ""}
              </p>
            </div>
            <div className="flex gap-6 sm:gap-8">
              <div>
                <p className="text-sm text-muted-foreground">R multiple</p>
                <p className="metric-value tnum mt-1">
                  {trade.r_multiple === null ? "—" : `${trade.r_multiple.toFixed(2)}R`}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">ROI</p>
                <p className="metric-value tnum mt-1">
                  {trade.roi_pct === null ? "—" : `${trade.roi_pct.toFixed(2)}%`}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 sm:grid-cols-3" aria-label="Trade facts">
          <article className="card-surface p-4">
            <h2 className="text-sm text-muted-foreground">Risk / reward</h2>
            <p className="mt-1 text-xl font-semibold tnum">{trade.risk_reward === null ? "—" : `1 : ${trade.risk_reward.toFixed(2)}`}</p>
          </article>
          <article className="card-surface p-4">
            <h2 className="text-sm text-muted-foreground">Duration</h2>
            <p className="mt-1 text-xl font-semibold tnum">{formatDuration(trade.duration_seconds)}</p>
          </article>
          <article className="card-surface p-4">
            <h2 className="text-sm text-muted-foreground">Leverage</h2>
            <p className="mt-1 text-xl font-semibold tnum">{trade.leverage}x</p>
          </article>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="motion-reveal card-surface p-4 sm:p-6" aria-label="Trade data">
            <h2 className="section-title">Trade data</h2>
            <dl className="mt-3 text-sm">
              <Row label="Entry" value={trade.entry_price} />
              <Row label="Exit" value={orDash(trade.exit_price)} />
              <Row label="Take profit" value={orDash(trade.tp)} />
              <Row label="Stop loss" value={orDash(trade.sl)} />
              <Row label="Position size" value={trade.position_size} />
              <Row label="Fees" value={formatMoney(trade.fees)} />
              <Row label="Strategy" value={orDash(detail.strategyName)} />
              <Row label="Setup" value={orDash(detail.setupName)} />
              <Row label="Market condition" value={trade.market_condition ? MARKET_CONDITION_LABELS[trade.market_condition] : "—"} />
              <Row label="Trade reason" value={trade.trade_reason ? TRADE_REASON_LABELS[trade.trade_reason] : "—"} />
              <Row label="Session" value={trade.session ? SESSION_LABELS[trade.session] : "—"} />
            </dl>
          </section>

          <section className="motion-reveal motion-reveal-1 card-surface p-4 sm:p-6" aria-label="Psychology and lesson">
            <h2 className="section-title">Psychology &amp; lesson</h2>
            <dl className="mt-3 text-sm">
              <Row label="Confidence" value={detail.psychology?.confidence ? `${detail.psychology.confidence} / 5` : "—"} />
              <Row label="Emotion" value={detail.psychology?.emotion ? EMOTION_LABELS[detail.psychology.emotion] : "—"} />
              <Row label="Discipline" value={detail.psychology?.discipline ? DISCIPLINE_LABELS[detail.psychology.discipline] : "—"} />
            </dl>
            <h3 className="mt-4 text-sm font-medium text-muted-foreground">What did I learn?</h3>
            {detail.lessons.length === 0 ? (
              <p className="mt-1 text-sm">No lesson recorded for this trade yet — add one in the review below.</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {detail.lessons.map((l) => (
                  <li key={l.id}>{l.text}</li>
                ))}
              </ul>
            )}
            {repeated && (
              <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                Your most repeated lesson: “{repeated.displayText}” — seen {repeated.count} times.
              </p>
            )}
            {trade.notes && (
              <>
                <h3 className="mt-4 text-sm font-medium text-muted-foreground">Notes</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{trade.notes}</p>
              </>
            )}
          </section>
        </div>

        <section className="motion-reveal motion-reveal-2 mt-6 card-surface p-4 sm:p-6" aria-label="Screenshots">
          <h2 className="section-title">Screenshots</h2>
          {detail.screenshots.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No screenshots attached to this trade yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {detail.screenshots.map((shot) => (
                <li key={shot.id} className="card-surface-inset p-3">
                  <p className="text-sm font-medium">{shot.file_name ?? shot.storage_path}</p>
                  <p className="text-xs text-muted-foreground">
                    OCR: {shot.ocr_status === "not_applicable" ? "not applicable — no OCR service is connected yet" : shot.ocr_status}
                    {shot.verified_by_user ? " · verified by you" : ""}
                  </p>
                  {screenshotUrls.get(shot.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={screenshotUrls.get(shot.id)} alt={`Screenshot for ${trade.pair} trade`} className="mt-3 max-h-96 w-full rounded-md object-contain" />
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Preview unavailable — the file could not be signed. The file is stored at {shot.storage_path}.</p>
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

        <section className="motion-reveal motion-reveal-3 mt-6 card-surface card-glow-violet p-4 sm:p-6" aria-label="AI insight">
          <h2 className="section-title">AI insight</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Not available yet. The AI Coach arrives in Phase 9 and will analyse your real trades — performance,
            mistakes, best and worst strategies, psychology and risk. Nothing is shown here until then; no insight
            is fabricated.
          </p>
        </section>

        {related.length > 0 && (
          <section className="motion-reveal motion-reveal-4 mt-6 card-surface p-4 sm:p-6" aria-label="Related trades">
            <h2 className="section-title">Related trades — {trade.pair}</h2>
            <ul className="mt-3 list-divider text-sm">
              {related.map(({ trade: rel }) => (
                <li key={rel.id} className="list-row-premium flex justify-between gap-4 py-2">
                  <Link href={`/trades/${rel.id}`} className="underline">
                    {rel.pair} · {rel.direction} · {new Date(rel.opened_at).toLocaleDateString()}
                  </Link>
                  <span className={`tnum ${rel.pnl === null ? "" : rel.pnl > 0 ? "text-emerald-400" : rel.pnl < 0 ? "text-red-400" : ""}`}>
                    {formatMoney(rel.pnl)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {editable && (
          <>
            <section className="motion-reveal motion-reveal-5 mt-6 card-surface p-4 sm:p-6" aria-label="Advanced review">
              <h2 className="section-title">Advanced review</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Strategy, psychology, lesson and notes are optional — add them now or any time later.
              </p>
              <div className="mt-4">
                <AdvancedReviewForm detail={detail} strategies={strategies} />
              </div>
            </section>

            <section className="motion-reveal motion-reveal-5 mt-6 card-surface p-4 sm:p-6" aria-label="Correct trade">
              <h2 className="section-title">Correct this trade</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Corrections never overwrite the original: saving a correction creates a new trade and marks this
                one as reversed, so the audit trail stays intact.
              </p>
              <div className="mt-4">
                <QuickTradeForm
                  action={correctTradeAction}
                  submitLabel="Save correction (creates a reversal)"
                  tradeId={trade.id}
                  initial={trade}
                />
              </div>
            </section>
          </>
        )}

        {trade.status === "open" && (
          <section className="motion-reveal motion-reveal-6 mt-6 card-surface p-4 sm:p-6" aria-label="Cancel trade">
            <h2 className="section-title">Cancel this trade</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only an open trade can be cancelled. A closed trade is a financial fact — correct it with a reversal
              instead of deleting it.
            </p>
            <form action={cancelTradeAction} className="mt-4">
              <input type="hidden" name="tradeId" value={trade.id} />
              <ConfirmButton label="Cancel trade" confirmLabel="Click again to cancel" />
            </form>
          </section>
        )}
    </AppShell>
  );
}
