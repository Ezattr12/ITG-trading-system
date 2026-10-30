import { formatMoney } from "@/lib/trades/calculations";
import type {
  CoachReport,
  PerformanceReport,
  PsychologyReport,
  RiskReport,
  StrategyReport,
} from "@/lib/reports/catalog";
import { DrawdownChart } from "@/components/analytics/charts";
import { Money, Pct } from "@/components/analytics/stat-card";

/**
 * Report catalog sections (Phase 24) for the Reports page.
 * Every figure comes from the composed catalog report over
 * the trader's real stored rows — sections render the
 * analyses' honest insufficient states verbatim rather than
 * drawing anything from invented data. Charts (the existing
 * DrawdownChart only) are always paired with their figures.
 */

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="itg-stat-row">
      <span className="itg-stat-row-label">{label}</span>
      <span className="itg-stat-row-value tabular-nums">{children}</span>
    </div>
  );
}

export function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; trades: number; wins: number; winRate: number | null; totalPnl: number }[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
      <h2 className="section-title">{title}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Trades</th>
              <th className="py-2 pr-3 font-medium">Wins</th>
              <th className="py-2 pr-3 font-medium">Win rate</th>
              <th className="py-2 font-medium">P&amp;L</th>
            </tr>
          </thead>
          <tbody className="list-divider">
            {rows.map((r) => (
              <tr key={r.name} className="list-row-premium">
                <td className="py-2 pr-3 capitalize">{r.name}</td>
                <td className="py-2 pr-3 tnum">{r.trades}</td>
                <td className="py-2 pr-3 tnum">{r.wins}</td>
                <td className="py-2 pr-3 tnum"><Pct value={r.winRate} /></td>
                <td className="py-2 tnum"><Money value={r.totalPnl} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PerformanceSections({ report }: { report: PerformanceReport }) {
  const dd = report.drawdown;
  return (
    <>
      <BreakdownTable title="By session" rows={report.summary.bySession} />
      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Drawdown (this period)</h2>
        {dd.status !== "ok" ? (
          <p className="mt-2 text-muted-foreground">
            Not enough closed trades in this period for a drawdown analysis ({dd.tradesCount}{" "}
            recorded; 5 are needed). The equity curve for the period is still shown in the
            figures above as trades close.
          </p>
        ) : (
          <div className="mt-3">
            <StatRow label="Maximum drawdown">{formatMoney(dd.maxDrawdown)}</StatRow>
            <StatRow label="Max drawdown (% of peak profit)">
              {dd.maxDrawdownPctOfPeak === null ? "—" : `${dd.maxDrawdownPctOfPeak.toFixed(1)}%`}
            </StatRow>
            <StatRow label="Current drawdown">{formatMoney(dd.currentDrawdown)}</StatRow>
            {dd.episode ? (
              <StatRow label="Worst episode">
                {dd.episode.peakDate} → {dd.episode.troughDate}
                {dd.episode.recovered ? ` · recovered ${dd.episode.recoveryDate ?? ""}` : " · not yet recovered"}
              </StatRow>
            ) : null}
            {dd.series.length > 1 ? (
              <div className="mt-4">
                <DrawdownChart data={dd.series} />
              </div>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
}

export function PsychologySections({ report }: { report: PsychologyReport }) {
  const { psychology: p, discipline: d } = report;
  return (
    <>
      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Psychology analysis</h2>
        {p.status !== "ok" ? (
          <p className="mt-2 text-muted-foreground">
            No psychology records in this period — record an emotion or confidence rating when
            you journal a trade and this analysis fills in.
          </p>
        ) : (
          <div className="mt-3">
            <StatRow label="Trades with a psychology record">{p.recordedTrades}</StatRow>
            <StatRow label="Average confidence">
              {p.avgConfidence === null ? "—" : p.avgConfidence.toFixed(1)}
            </StatRow>
            {p.emotionStatement ? (
              <p className="mt-3 text-sm text-muted-foreground">{p.emotionStatement}</p>
            ) : null}
            {p.confidenceStatement ? (
              <p className="mt-2 text-sm text-muted-foreground">{p.confidenceStatement}</p>
            ) : null}
            {!p.emotionStatement && !p.confidenceStatement ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No relationship statement is made here: one is only stated when both compared
                groups have at least 3 trades and their win rates differ by at least 20 points.
              </p>
            ) : null}
          </div>
        )}
      </section>
      <BreakdownTable
        title="By confidence band"
        rows={p.byConfidence.map((g) => ({
          name: g.label,
          trades: g.trades,
          wins: g.wins,
          winRate: g.winRate,
          totalPnl: g.totalPnl,
        }))}
      />
      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Discipline</h2>
        <div className="mt-3">
          <StatRow label="Trades with a stop-loss">{d.stopLossPct.toFixed(1)}%</StatRow>
          <StatRow label="Journal completion">{d.journalCompletionPct.toFixed(1)}%</StatRow>
          <StatRow label="Stop-loss set vs not">
            {d.stopLoss.a.trades} trades · <Money value={d.stopLoss.a.totalPnl} /> /{" "}
            {d.stopLoss.b.trades} trades · <Money value={d.stopLoss.b.totalPnl} />
          </StatRow>
          <StatRow label="Journaled vs not">
            {d.journaled.a.trades} trades · <Money value={d.journaled.a.totalPnl} /> /{" "}
            {d.journaled.b.trades} trades · <Money value={d.journaled.b.totalPnl} />
          </StatRow>
          {d.rating ? (
            <StatRow label="Rated good vs average/poor">
              {d.rating.a.trades} trades · <Money value={d.rating.a.totalPnl} /> /{" "}
              {d.rating.b.trades} trades · <Money value={d.rating.b.totalPnl} />
            </StatRow>
          ) : null}
          {[d.stopLoss.statement, d.journaled.statement, d.rating?.statement]
            .filter(Boolean)
            .map((stmt, i) => (
              <p key={i} className="mt-2 text-sm text-muted-foreground">{stmt}</p>
            ))}
        </div>
      </section>
    </>
  );
}

export function RiskSections({ report }: { report: RiskReport }) {
  const r = report.risk;
  return (
    <>
      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Risk behaviour (this period)</h2>
        {r.status !== "ok" ? (
          <p className="mt-2 text-muted-foreground">
            No closed trades in this period — there is nothing to analyse yet.
          </p>
        ) : (
          <div className="mt-3">
            {r.distribution ? (
              <>
                <StatRow label="Planned risk — average">{formatMoney(r.distribution.avg)}</StatRow>
                <StatRow label="Planned risk — median">{formatMoney(r.distribution.median)}</StatRow>
                <StatRow label="Planned risk — range">
                  {formatMoney(r.distribution.min)} – {formatMoney(r.distribution.max)}
                </StatRow>
              </>
            ) : (
              <StatRow label="Planned risk">No trade in this period had a stop-loss to measure</StatRow>
            )}
            <StatRow label="Trades without a stop-loss">{r.withoutStopLossCount}</StatRow>
            <StatRow label="Per-trade risk limit">
              {r.riskLimitPct === null
                ? "No limit configured"
                : r.overLimitCount === null
                  ? `${r.riskLimitPct}% — capital not on file, limit check unavailable`
                  : `${r.riskLimitPct}% — ${r.overLimitCount} trade(s) over`}
            </StatRow>
            <StatRow label="Daily loss limit">
              {r.dailyLossLimit === null
                ? "No limit configured"
                : `${formatMoney(r.dailyLossLimit)} — ${r.dailyLossBreachDays ?? 0} breach day(s)`}
            </StatRow>
            {r.worstDay ? (
              <StatRow label="Worst day">
                {r.worstDay.date} · <Money value={r.worstDay.pnl} />
              </StatRow>
            ) : null}
            <StatRow label="Leverage">
              {r.maxLeverageUsed === null
                ? "—"
                : `max used ${r.maxLeverageUsed}x${r.leverageLimit === null ? "" : ` · limit ${r.leverageLimit}x · ${r.leverageOverCount ?? 0} over`}`}
            </StatRow>
            <StatRow label="Longest losing streak">{r.maxConsecutiveLosses}</StatRow>
            {r.trend ? (
              <StatRow label="Planned-risk trend">
                recent {formatMoney(r.trend.recentAvg)} vs prior {formatMoney(r.trend.priorAvg)}
                {r.trend.deltaPct === null ? "" : ` (${r.trend.deltaPct >= 0 ? "+" : ""}${r.trend.deltaPct.toFixed(1)}%)`}
              </StatRow>
            ) : null}
          </div>
        )}
      </section>

      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Configured limits</h2>
        <div className="mt-3">
          <StatRow label="Risk rules">
            {report.rules
              ? `risk/trade ${report.rules.max_risk_per_trade_pct === null ? "not set" : `${report.rules.max_risk_per_trade_pct}%`} · daily loss ${report.rules.max_daily_loss === null ? "not set" : formatMoney(report.rules.max_daily_loss)} · leverage ${report.rules.max_leverage === null ? "not set" : `${report.rules.max_leverage}x`}`
              : "No active risk rules"}
          </StatRow>
          <StatRow label="Trading plan">
            {report.plan
              ? `${report.plan.name} · risk/trade ${report.plan.risk_per_trade_pct === null ? "not set" : `${report.plan.risk_per_trade_pct}%`} · daily loss ${report.plan.max_daily_loss === null ? "not set" : formatMoney(report.plan.max_daily_loss)}`
              : "No active trading plan"}
          </StatRow>
        </div>
        {report.periodRiskEvents.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 font-medium">Event</th>
                </tr>
              </thead>
              <tbody className="list-divider">
                {report.periodRiskEvents.map((e) => (
                  <tr key={e.id} className="list-row-premium">
                    <td className="py-2 pr-3 tnum">{e.created_at.slice(0, 10)}</td>
                    <td className="py-2 pr-3 capitalize">{e.severity}</td>
                    <td className="py-2">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No stored risk events were recorded in this period.
          </p>
        )}
      </section>

      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Drawdown (this period)</h2>
        {report.drawdown.status !== "ok" ? (
          <p className="mt-2 text-muted-foreground">
            Not enough closed trades in this period for a drawdown analysis (
            {report.drawdown.tradesCount} recorded; 5 are needed).
          </p>
        ) : (
          <div className="mt-3">
            <StatRow label="Maximum drawdown">{formatMoney(report.drawdown.maxDrawdown)}</StatRow>
            <StatRow label="Current drawdown">{formatMoney(report.drawdown.currentDrawdown)}</StatRow>
          </div>
        )}
      </section>
    </>
  );
}

export function StrategySections({ report }: { report: StrategyReport }) {
  return (
    <>
      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Most / least profitable strategy</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Only strategies with at least 3 trades in this period are ranked — below that the
          sample cannot support a ranking.
        </p>
        <div className="mt-3">
          <StatRow label="Most profitable">
            {report.bestStrategy
              ? `${report.bestStrategy.name} · ${report.bestStrategy.trades} trades`
              : "No strategy has 3 or more trades yet"}
          </StatRow>
          {report.bestStrategy ? (
            <StatRow label="Its total P&L"><Money value={report.bestStrategy.totalPnl} /></StatRow>
          ) : null}
          <StatRow label="Least profitable">
            {report.worstStrategy
              ? `${report.worstStrategy.name} · ${report.worstStrategy.trades} trades`
              : "Only one strategy qualifies, or none do"}
          </StatRow>
          {report.worstStrategy ? (
            <StatRow label="Its total P&L"><Money value={report.worstStrategy.totalPnl} /></StatRow>
          ) : null}
        </div>
      </section>
      <BreakdownTable
        title="Strategy by session (3+ trades)"
        rows={report.strategySessionRows.map((r) => ({
          name: r.label,
          trades: r.trades,
          wins: r.wins,
          winRate: r.winRate,
          totalPnl: r.totalPnl,
        }))}
      />
      {report.recurring.losingSetups.length > 0 ? (
        <BreakdownTable
          title="Losing setups (2+ losses)"
          rows={report.recurring.losingSetups.map((s) => ({
            name: s.name,
            trades: s.trades,
            wins: s.trades - s.losses,
            winRate: s.winRate,
            totalPnl: s.totalPnl,
          }))}
        />
      ) : null}
    </>
  );
}

export function CoachSections({ report }: { report: CoachReport }) {
  const digest = report.digest;
  return (
    <>
      <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
        <h2 className="section-title">Coach findings for this period</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          From the deterministic Coach Engine and your stored coach insights — no AI-generated
          text is added here.
        </p>
        {!digest || digest.status !== "ok" ? (
          <p className="mt-2 text-muted-foreground">
            No coach findings for this period — the coach needs closed trades in the period to
            analyse it.
          </p>
        ) : digest.coachFindings.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            The coach produced no findings for this period.
          </p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {digest.coachFindings.map((f, i) => (
              <li key={i}>
                <span className="font-medium">{f.title}</span>
                {f.recommendation ? (
                  <span className="block text-muted-foreground">{f.recommendation}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.storedInsights.length > 0 ? (
        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
          <h2 className="section-title">Stored coach insights in this period</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {report.storedInsights.map((row) => (
              <li key={row.id}>
                <span className="font-medium">{row.summary}</span>
                {row.metrics_snapshot?.recommendation ? (
                  <span className="block text-muted-foreground">
                    {row.metrics_snapshot.recommendation}
                  </span>
                ) : null}
                <span className="block text-xs text-muted-foreground">
                  {row.period_start ?? "—"} to {row.period_end ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {digest && digest.focus.length > 0 ? (
        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
          <h2 className="section-title">Focus for the next period</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {digest.focus.map((a) => (
              <li key={a.title}>
                <span className="font-medium">{a.title}</span>
                <span className="block text-muted-foreground">{a.evidence}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 sm:mt-8 card-surface-raised p-4 sm:p-6">
        <h2 className="section-title">Recommendations</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Rule-based observations from this period&apos;s own data — not generic advice.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          {report.recommendations.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
