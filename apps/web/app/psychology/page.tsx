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
 */

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; trades: number; pnl: number; winRate: number | null }[];
}) {
  return (
    <section className="mt-6 sm:mt-8" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No data yet — record emotion, confidence and discipline in
          a trade&apos;s Advanced Review and it will appear here.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto card-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Group</th>
                <th className="px-3 py-2 font-medium">Trades</th>
                <th className="px-3 py-2 font-medium">P&amp;L</th>
                <th className="px-3 py-2 font-medium">Win rate</th>
              </tr>
            </thead>
            <tbody className="list-divider">
              {rows.map((row) => (
                <tr key={row.label} className="list-row-premium">
                  <td className="px-3 py-2 font-medium capitalize">{row.label}</td>
                  <td className="px-3 py-2 tnum">{row.trades}</td>
                  <td className={`px-3 py-2 tnum ${row.pnl > 0 ? "text-emerald-400" : row.pnl < 0 ? "text-red-400" : ""}`}>{formatMoney(row.pnl)}</td>
                  <td className="px-3 py-2 tnum">
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
        <h1 className="page-title">Psychology</h1>
        <p className="page-lede">
          How your state of mind lines up with your results. These
          options exist for honest journaling — FOMO and revenge
          trades are recorded so you can see their cost, not
          encouraged.
        </p>

        {bundle.trades.length === 0 && (
          <p role="status" className="mt-4 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            No closed trades yet — psychology data appears here once
            you journal trades with emotion, confidence and discipline.
          </p>
        )}

        <section className="mt-6 sm:mt-8 grid gap-4 sm:grid-cols-3" aria-label="Psychology summary">
          <article className="card-surface p-4 sm:p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Average confidence</h2>
            <p className="mt-2 text-xl font-semibold tnum">
              {psych.avgConfidence === null ? "—" : `${psych.avgConfidence.toFixed(1)} / 5`}
            </p>
          </article>
          <article className="card-surface p-4 sm:p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Good discipline</h2>
            <p className="mt-2 text-xl font-semibold tnum">
              {psych.goodDisciplinePct === null ? "—" : `${psych.goodDisciplinePct.toFixed(0)}%`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Share of rated trades with good discipline.</p>
          </article>
          <article className="card-surface p-4 sm:p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Journal completion</h2>
            <p className="mt-2 text-xl font-semibold tnum">
              {psych.journalCompletionPct.toFixed(0)}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Closed trades with a psychology record or lesson.</p>
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
