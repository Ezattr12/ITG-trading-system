import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { getAnalyticsBundle } from "@/lib/analytics/queries";
import {
  breakdownBy,
  psychologySummary,
} from "@/lib/analytics/analytics";
import { formatMoney } from "@/lib/trades/calculations";

export const metadata = { title: "Psychology — ITG TraderOS" };

/**
 * Psychology page (Phase 5, spec §14, §18).
 *
 * Emotion, confidence and discipline against performance — all
 * from the trader's real closed trades and the psychology records
 * they entered in Advanced Review. With no psychology data yet
 * the page says so honestly; nothing is estimated.
 *
 * Master Web UI Redesign (Task 8) — PRESENTATION ONLY: the
 * page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, the summary as .itg2-kpi cards,
 * and each breakdown as a glass panel holding an .itg2-table
 * whose P&L keeps its profit / loss tone via .itg2-text-profit
 * / .itg2-text-loss). All data, copy and empty states are
 * exactly as before. Psychology is the trader's own record,
 * not AI — no violet anywhere on this page.
 */

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; trades: number; pnl: number; winRate: number | null }[];
}) {
  return (
    <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label={title}>
      <h2 className="itg2-section-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No data yet — record emotion, confidence and discipline in
          a trade&apos;s Advanced Review and it will appear here.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="itg2-table itg2-table-fit">
            <thead>
              <tr>
                <th>Group</th>
                <th>Trades</th>
                <th>P&amp;L</th>
                <th>Win rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="capitalize">{row.label}</td>
                  <td className="tnum">{row.trades}</td>
                  <td className={`tnum ${row.pnl > 0 ? "itg2-text-profit" : row.pnl < 0 ? "itg2-text-loss" : ""}`}>{formatMoney(row.pnl)}</td>
                  <td className="tnum">
                    {row.winRate === null ? "—" : `${row.winRate.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function PsychologyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const bundle = configured
    ? await getAnalyticsBundle(await createServerSupabaseClient(), user.id)
    : { trades: [], goals: [], xpTotal: 0, xpHistory: [], levelName: null, levelScore: null, levels: [], dailyActivity: [] };
  const psych = psychologySummary(bundle.trades);
  const byConfidence = breakdownBy(
    bundle.trades,
    (t) => (t.confidence === null ? null : String(t.confidence)),
    (key) => (key === "unknown" ? "Not rated" : `Confidence ${key}`),
  ).filter((row) => row.key !== "unknown");
  const byDiscipline = breakdownBy(
    bundle.trades,
    (t) => t.discipline,
    (key) => (key === "unknown" ? "Not rated" : key),
  ).filter((row) => row.key !== "unknown");

  return (
    <AppShell email={user.email}>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Psychology</p>
          <h1 className="itg2-page-title mt-1">Psychology</h1>
          <p className="mt-2 text-muted-foreground">
            How your state of mind lines up with your results. These
            options exist for honest journaling — FOMO and revenge
            trades are recorded so you can see their cost, not
            encouraged.
          </p>
        </header>

        {bundle.trades.length === 0 && (
          <p role="status" className="itg2-notice itg2-notice-neutral mt-4">
            No closed trades yet — psychology data appears here once
            you journal trades with emotion, confidence and discipline.
          </p>
        )}

        <section className="mt-6 sm:mt-8 grid gap-4 sm:grid-cols-3" aria-label="Psychology summary">
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Average confidence</h2>
            <p className="itg2-kpi-value tnum">
              {psych.avgConfidence === null ? "—" : `${psych.avgConfidence.toFixed(1)} / 5`}
            </p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Good discipline</h2>
            <p className="itg2-kpi-value tnum">
              {psych.goodDisciplinePct === null ? "—" : `${psych.goodDisciplinePct.toFixed(0)}%`}
            </p>
            <p className="itg2-kpi-hint">Share of rated trades with good discipline.</p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Journal completion</h2>
            <p className="itg2-kpi-value tnum">
              {psych.journalCompletionPct.toFixed(0)}%
            </p>
            <p className="itg2-kpi-hint">Closed trades with a psychology record or lesson.</p>
          </article>
        </section>

        <BreakdownTable
          title="Performance by emotion"
          rows={psych.byEmotion.map((row) => ({ ...row, label: row.emotion }))}
        />
        <BreakdownTable title="Performance by confidence" rows={byConfidence} />
        <BreakdownTable title="Performance by discipline" rows={byDiscipline} />
    </AppShell>
  );
}
