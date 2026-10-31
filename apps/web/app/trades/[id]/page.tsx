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
    <div className="itg2-row">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tnum">{value}</dd>
    </div>
  );
}

/** Panel header: blue eyebrow over the section title. */
function SectionHeader({ eyebrow, title }: { eyebrow: string; title: React.ReactNode }) {
  return (
    <div>
      <p className="itg2-eyebrow">{eyebrow}</p>
      <h2 className="itg2-section-title mt-1">{title}</h2>
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
 *
 * Master Web UI Redesign Page 4 — v2 glass presentation:
 * identity + result merge into the L3 .itg2-hero (pair,
 * direction / status / win-loss chips, the P&L as the hero
 * figure with R and ROI as band values); the numeric facts
 * become .itg2-card tiles; the context values stay as
 * definition rows inside L1 panels; screenshots sit in
 * .itg2-shot glass frames; the banners are .itg2-notice
 * bars. Every action, form, payload and href is unchanged.
 * Note: this page has never rendered an audit-history
 * section — getTradeDetail returns no audit rows; the
 * audit trail surfaces here as the reversal banners.
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
          <Link href="/trades" className="itg2-link">
            ← Back to trades
          </Link>
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
          <p role="status" className="itg2-notice itg2-notice-warning motion-fade-in mt-4">
            <span>
              <strong>Screenshot not attached.</strong> Your trade was saved, but the screenshot upload
              failed — you can add it below in the Screenshots section.
            </span>
          </p>
        ) : null}

        {trade.status === "reversed" && detail.correctingTrade && (
          <p role="status" className="itg2-notice itg2-notice-warning mt-4">
            <span>
              This trade was corrected. The correcting trade is{" "}
              <Link href={`/trades/${detail.correctingTrade.id}`} className="underline">
                here
              </Link>
              . The original values are kept for the audit trail.
            </span>
          </p>
        )}
        {detail.reversedTrade && (
          <p role="status" className="itg2-notice itg2-notice-neutral mt-4">
            <span>
              This trade corrects{" "}
              <Link href={`/trades/${detail.reversedTrade.id}`} className="underline">
                {detail.reversedTrade.pair} (reversed)
              </Link>
              .
            </span>
          </p>
        )}

        {/* Trade hero (Phase 18 result hero, Page 4 v2): the
            identity and the real outcome in one L3 glass
            surface — pair, direction / status / win-loss
            chips, opened / closed times, then the large
            tabular P&L with R and ROI as band values. The
            P&L colour is semantic (profit / loss tokens);
            an open trade reads "Open" in the neutral
            foreground. No value is dropped. */}
        <section className="itg2-hero mt-5 p-5 sm:p-8" aria-label="Trade result">
          <div className="itg2-hero-rings" aria-hidden="true" />
          <div className="itg2-hero-inner">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="itg2-page-title">{trade.pair}</h1>
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
              {trade.is_win === true && <span className="itg2-chip itg2-chip-profit">Win</span>}
              {trade.is_win === false && <span className="itg2-chip itg2-chip-loss">Loss</span>}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Opened {new Date(trade.opened_at).toLocaleString()}
              {trade.closed_at ? ` · Closed ${new Date(trade.closed_at).toLocaleString()}` : " · Still open"}
            </p>
            <div className="mt-7 flex flex-wrap items-end justify-between gap-6">
              <div>
                <h2 className="itg2-eyebrow">Trade result</h2>
                <p
                  className={`itg2-hero-value mt-2 ${
                    trade.pnl === null ? "" : trade.pnl > 0 ? "itg2-text-profit" : trade.pnl < 0 ? "itg2-text-loss" : ""
                  }`}
                >
                  {trade.status === "open" ? "Open" : formatMoney(trade.pnl)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
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
                  <p className="itg2-band-label">R multiple</p>
                  <p className="itg2-band-value mt-1">
                    {trade.r_multiple === null ? "—" : `${trade.r_multiple.toFixed(2)}R`}
                  </p>
                </div>
                <div>
                  <p className="itg2-band-label">ROI</p>
                  <p className="itg2-band-value mt-1">
                    {trade.roi_pct === null ? "—" : `${trade.roi_pct.toFixed(2)}%`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* The numeric facts as glass tiles — the values the
            old facts strip and the price rows of Trade data
            carried, each in its own tile. */}
        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4" aria-label="Trade facts">
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Entry</p>
            <p className="itg2-stat-value">{trade.entry_price}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Exit</p>
            <p className="itg2-stat-value">{orDash(trade.exit_price)}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Take profit</p>
            <p className="itg2-stat-value">{orDash(trade.tp)}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Stop loss</p>
            <p className="itg2-stat-value">{orDash(trade.sl)}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Position size</p>
            <p className="itg2-stat-value">{trade.position_size}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Fees</p>
            <p className="itg2-stat-value">{formatMoney(trade.fees)}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Risk / reward</p>
            <p className="itg2-stat-value">{trade.risk_reward === null ? "—" : `1 : ${trade.risk_reward.toFixed(2)}`}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Duration</p>
            <p className="itg2-stat-value">{formatDuration(trade.duration_seconds)}</p>
          </article>
          <article className="itg2-card p-4">
            <p className="itg2-band-label">Leverage</p>
            <p className="itg2-stat-value">{trade.leverage}x</p>
          </article>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="motion-reveal itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Strategy and session">
            <SectionHeader eyebrow="Context" title="Strategy & session" />
            <dl className="mt-3 text-sm">
              <Row label="Strategy" value={orDash(detail.strategyName)} />
              <Row label="Setup" value={orDash(detail.setupName)} />
              <Row label="Session" value={trade.session ? SESSION_LABELS[trade.session] : "—"} />
              <Row label="Market condition" value={trade.market_condition ? MARKET_CONDITION_LABELS[trade.market_condition] : "—"} />
              <Row label="Trade reason" value={trade.trade_reason ? TRADE_REASON_LABELS[trade.trade_reason] : "—"} />
            </dl>
          </section>

          <section className="motion-reveal motion-reveal-1 itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Psychology and lesson">
            <SectionHeader eyebrow="Psychology" title="Psychology & lesson" />
            <dl className="mt-3 text-sm">
              <Row label="Confidence" value={detail.psychology?.confidence ? `${detail.psychology.confidence} / 5` : "—"} />
              <Row label="Emotion" value={detail.psychology?.emotion ? EMOTION_LABELS[detail.psychology.emotion] : "—"} />
              <Row label="Discipline" value={detail.psychology?.discipline ? DISCIPLINE_LABELS[detail.psychology.discipline] : "—"} />
            </dl>
            <h3 className="mt-5 text-sm font-medium text-muted-foreground">What did I learn?</h3>
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
              <p className="itg2-notice itg2-notice-warning mt-4">
                <span>
                  Your most repeated lesson: “{repeated.displayText}” — seen {repeated.count} times.
                </span>
              </p>
            )}
            {trade.notes && (
              <>
                <h3 className="mt-5 text-sm font-medium text-muted-foreground">Notes</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{trade.notes}</p>
              </>
            )}
          </section>
        </div>

        <section className="motion-reveal motion-reveal-2 mt-6 itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Screenshots">
          <SectionHeader eyebrow="Evidence" title="Screenshots" />
          {detail.screenshots.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No screenshots attached to this trade yet.</p>
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

        <section className="motion-reveal motion-reveal-2 mt-6 itg2-card itg2-card-ai p-5 sm:p-6" aria-label="AI insight">
          <div className="flex items-start gap-4">
            <span className="itg2-ai-orb" aria-hidden="true">
              <span className="itg2-ai-orb-dot" />
            </span>
            <div className="min-w-0">
              <p className="itg2-eyebrow itg2-eyebrow-ai">AI Coach</p>
              <h2 className="itg2-section-title mt-1">AI insight</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Not available yet. The AI Coach arrives in Phase 9 and will analyse your real trades — performance,
                mistakes, best and worst strategies, psychology and risk. Nothing is shown here until then; no insight
                is fabricated.
              </p>
            </div>
          </div>
        </section>

        {related.length > 0 && (
          <section className="motion-reveal motion-reveal-4 mt-6 itg2-card p-5 sm:p-6" aria-label="Related trades">
            <SectionHeader eyebrow="Journal" title={`Related trades — ${trade.pair}`} />
            <ul className="mt-3 text-sm">
              {related.map(({ trade: rel }) => (
                <li key={rel.id} className="itg2-row items-center">
                  <Link href={`/trades/${rel.id}`} className="itg2-link">
                    {rel.pair} · {rel.direction} · {new Date(rel.opened_at).toLocaleDateString()}
                  </Link>
                  <span className={`tnum ${rel.pnl === null ? "" : rel.pnl > 0 ? "itg2-text-profit" : rel.pnl < 0 ? "itg2-text-loss" : ""}`}>
                    {formatMoney(rel.pnl)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {editable && (
          <>
            <section className="motion-reveal motion-reveal-5 mt-6 itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Advanced review">
              <SectionHeader eyebrow="Review" title="Advanced review" />
              <p className="mt-1 text-sm text-muted-foreground">
                Strategy, psychology, lesson and notes are optional — add them now or any time later.
              </p>
              <div className="mt-4">
                <AdvancedReviewForm detail={detail} strategies={strategies} />
              </div>
            </section>

            <section className="motion-reveal motion-reveal-5 mt-6 itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Correct trade">
              <SectionHeader eyebrow="Corrections" title="Correct this trade" />
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
          <section className="motion-reveal motion-reveal-6 mt-6 itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Cancel trade">
            <SectionHeader eyebrow="Danger zone" title="Cancel this trade" />
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
