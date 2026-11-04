import { formatMoney } from "@/lib/trades/calculations";
import type {
  BacktestingResearchAnalysis,
  DisciplineSplit,
  GroupStat,
  IntelligenceOverview,
  MarketConditionsAnalysis,
  PatternAnalysis,
  PatternKind,
  PeriodDigest,
  TradingPattern,
} from "@/lib/intelligence/types";
import { DrawdownChart } from "./charts";
import { Money, Pct } from "./stat-card";

/**
 * Advanced intelligence section (Phase 23) for the Analytics
 * page. Every figure comes from the intelligence analyses
 * over the trader's real stored rows — panels render the
 * analyses' honest insufficient states verbatim rather than
 * drawing anything from invented data.
 */

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="itg-stat-row">
      <span className="itg-stat-row-label">{label}</span>
      <span className="itg-stat-row-value tabular-nums">{children}</span>
    </div>
  );
}

function GroupTable({ rows }: { rows: GroupStat[] }) {
  if (rows.length === 0) {
    return <p className="mt-2 text-muted-foreground">Nothing recorded yet.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
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
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="font-medium capitalize">{r.label}</td>
              <td className="tabular-nums">{r.trades}</td>
              <td><Money value={r.totalPnl} /></td>
              <td><Pct value={r.winRate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SplitBlock({ title, split }: { title: string; split: DisciplineSplit }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <GroupTable rows={[split.a, split.b]} />
      {split.statement ? (
        <p className="mt-2 text-sm text-muted-foreground">{split.statement}</p>
      ) : null}
    </div>
  );
}

function DigestCard({ digest }: { digest: PeriodDigest }) {
  const label = digest.kind === "weekly" ? "This week" : "This month";
  return (
    <section className="itg2-card p-5 sm:p-6" aria-label={`${label} review digest`}>
      <p className="itg2-eyebrow">Performance</p>
      <h2 className="itg2-section-title mt-1">{label} — review digest</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {digest.periodStart} to {digest.periodEnd}
      </p>
      {digest.status !== "ok" ? (
        <p className="mt-2 text-muted-foreground">
          No closed trades in this period yet — the digest fills in from your real trades as they close.
        </p>
      ) : (
        <div className="mt-3">
          <StatRow label="Closed trades">{digest.tradesCount}</StatRow>
          <StatRow label="Total P&L"><Money value={digest.totalPnl} /></StatRow>
          <StatRow label="Win rate"><Pct value={digest.winRate} /></StatRow>
          {digest.drawdown.maxDrawdown > 0 ? (
            <StatRow label="Deepest fall from peak">{formatMoney(digest.drawdown.maxDrawdown)}</StatRow>
          ) : null}
          {digest.patterns.status !== "ok" ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Patterns need at least 5 closed trades in the period — this period has{" "}
              {digest.patterns.tradesCount}.
            </p>
          ) : digest.patterns.patterns.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No standout patterns this {digest.kind === "weekly" ? "week" : "month"} —
              no group of 3 or more trades separated itself from the period&apos;s
              overall results.
            </p>
          ) : (
            <>
              <h3 className="mt-4 text-sm font-semibold">
                Patterns this {digest.kind === "weekly" ? "week" : "month"}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Measured against this period&apos;s own overall results, with the
                same standard as Your patterns.
              </p>
              <ul className="mt-1">
                {digest.patterns.patterns.slice(0, 4).map((p) => (
                  <li
                    key={`${p.kind}-${p.key}`}
                    className="border-t border-border pt-2 mt-2 first:border-t-0 first:mt-1 first:pt-1"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span className="capitalize">
                        {p.kind === "repeated_mistake" ? `“${p.label}”` : p.label}
                      </span>
                      {p.direction === "edge" ? (
                        <span className="itg2-chip itg2-chip-profit whitespace-nowrap">Edge</span>
                      ) : p.direction === "drag" ? (
                        <span className="itg2-chip itg2-chip-loss whitespace-nowrap">Drag</span>
                      ) : (
                        <span className="itg2-chip itg2-chip-warning whitespace-nowrap">Repeats</span>
                      )}
                      <span className="text-xs font-normal text-muted-foreground">
                        {PATTERN_KIND_LABELS[p.kind]}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <PatternEvidence pattern={p} />
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {digest.coachFindings.length > 0 ? (
            <>
              <h3 className="mt-4 text-sm font-semibold">Coach findings</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {digest.coachFindings.slice(0, 4).map((f) => (
                  <li key={f.title}>{f.title}</li>
                ))}
              </ul>
            </>
          ) : null}
          {digest.focus.length > 0 ? (
            <>
              <h3 className="mt-4 text-sm font-semibold">Focus for the next period</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {digest.focus.map((a) => (
                  <li key={a.title}>{a.title}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

const PATTERN_KIND_LABELS: Record<PatternKind, string> = {
  strategy: "Strategy",
  session: "Session",
  direction: "Direction",
  pair: "Pair",
  setup: "Setup",
  market_condition: "Market condition",
  emotion: "Emotion",
  confidence: "Confidence",
  session_direction: "Session · direction",
  strategy_session: "Strategy · session",
  stop_loss: "Stop-loss",
  repeated_mistake: "Repeated mistake",
};

function PatternEvidence({ pattern }: { pattern: TradingPattern }) {
  if (pattern.kind === "repeated_mistake") {
    return (
      <>
        Recorded {pattern.occurrences}× in your lessons
        {pattern.trades > 0 ? (
          <>
            {" "}· linked to {pattern.trades} closed trade{pattern.trades === 1 ? "" : "s"}{" "}
            totalling <Money value={pattern.totalPnl} />
          </>
        ) : (
          " · no linked closed trades yet"
        )}
        .
      </>
    );
  }
  return (
    <>
      {pattern.trades} trades · win rate <Pct value={pattern.winRate} /> vs your{" "}
      <Pct value={pattern.baselineWinRate} /> overall · total P&amp;L{" "}
      <Money value={pattern.totalPnl} />
      {pattern.basis === "pnl_dominance" && pattern.pnlShare !== null
        ? ` · ${(pattern.pnlShare * 100).toFixed(1)}% of your total P&L movement`
        : ""}
      .
    </>
  );
}

function PatternsCard({ patterns }: { patterns: PatternAnalysis }) {
  return (
    <section
      className="itg2-card p-5 sm:p-6 min-[801px]:col-span-2"
      aria-label="Your patterns"
    >
      <p className="itg2-eyebrow">Patterns</p>
      <h2 className="itg2-section-title mt-1">Your patterns</h2>
      <p className="mt-1 max-w-[720px] text-xs leading-relaxed text-muted-foreground">
        A pattern is shown only when a group of 3 or more closed trades beats or trails
        your overall win rate by at least 20 points, or accounts for at least half of
        your total P&amp;L movement. Patterns describe your recorded history — they are
        not predictions.
      </p>
      {patterns.status !== "ok" ? (
        <p className="mt-3 text-muted-foreground">
          Patterns appear once you have at least 5 closed trades and a group of 3 or
          more that stands out — you have {patterns.tradesCount} closed trade
          {patterns.tradesCount === 1 ? "" : "s"}.
        </p>
      ) : patterns.patterns.length === 0 ? (
        <p className="mt-3 text-muted-foreground">
          No group of 3 or more trades stands out from your overall results yet — your
          results are spread evenly across the strategies, sessions and conditions
          measured so far.
        </p>
      ) : (
        <ul className="mt-2">
          {patterns.patterns.map((p) => (
            <li
              key={`${p.kind}-${p.key}`}
              className="border-t border-border pt-3 mt-3 first:border-t-0 first:mt-1 first:pt-2"
            >
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span className="capitalize">
                  {p.kind === "repeated_mistake" ? `“${p.label}”` : p.label}
                </span>
                {p.direction === "edge" ? (
                  <span className="itg2-chip itg2-chip-profit whitespace-nowrap">Edge</span>
                ) : p.direction === "drag" ? (
                  <span className="itg2-chip itg2-chip-loss whitespace-nowrap">Drag</span>
                ) : (
                  <span className="itg2-chip itg2-chip-warning whitespace-nowrap">Repeats</span>
                )}
                <span className="text-xs font-normal text-muted-foreground">
                  {PATTERN_KIND_LABELS[p.kind]}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <PatternEvidence pattern={p} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MarketConditionsCard({ conditions }: { conditions: MarketConditionsAnalysis }) {
  const hasSmallSample = conditions.rows.some((r) => !r.comparable);
  return (
    <section
      className="itg2-card p-5 sm:p-6 min-[801px]:col-span-2"
      aria-label="Market conditions"
    >
      <p className="itg2-eyebrow">Conditions</p>
      <h2 className="itg2-section-title mt-1">Market conditions</h2>
      <p className="mt-1 max-w-[720px] text-xs leading-relaxed text-muted-foreground">
        Your results grouped by the market condition recorded on each trade. ITG has
        no live market feed, so a condition here is always the label you recorded in
        a trade&apos;s review — never a live market reading. Groups of 3 or more
        trades can be compared with your overall results: a condition stands out in
        Your patterns when its win rate differs from your overall win rate by at
        least 20 points, or when it accounts for at least half of your total
        P&amp;L movement.
      </p>
      {conditions.tradesCount < 5 ? (
        <p className="mt-3 text-muted-foreground">
          Condition comparisons appear once you have at least 5 closed trades — you
          have {conditions.tradesCount} closed trade
          {conditions.tradesCount === 1 ? "" : "s"}.
        </p>
      ) : conditions.recordedTrades === 0 ? (
        <p className="mt-3 max-w-[720px] text-muted-foreground">
          No market conditions recorded yet — so there is nothing to compare. A
          condition is recorded when you review a trade: open any trade and choose
          its Market condition in the advanced review (Trending, Ranging, Choppy,
          High volatility, Low volatility or Other). Quick entry does not ask for
          one. Once your closed trades carry conditions, your results are grouped
          here, condition by condition.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">
            Condition recorded on {conditions.recordedTrades} of{" "}
            {conditions.tradesCount} closed trades.
            {conditions.unrecordedTrades > 0
              ? " The rest carry no condition and form no group."
              : ""}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="itg2-table itg2-table-fit">
              <thead>
                <tr>
                  <th>Condition</th>
                  <th>Trades</th>
                  <th>Win rate</th>
                  <th>P&amp;L</th>
                  <th>Share of P&amp;L movement</th>
                </tr>
              </thead>
              <tbody>
                {conditions.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="font-medium capitalize">
                      {r.label}
                      {!r.comparable ? (
                        <span className="itg2-chip itg2-chip-muted ml-2 whitespace-nowrap">
                          Small sample
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular-nums">{r.trades}</td>
                    <td><Pct value={r.winRate} /></td>
                    <td><Money value={r.totalPnl} /></td>
                    <td className="tabular-nums">
                      {r.pnlShare !== null ? `${(r.pnlShare * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasSmallSample ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Small-sample rows have fewer than 3 trades — they are shown as
              recorded evidence, but no comparison is drawn from them.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function BacktestingResearchCard({ research }: { research: BacktestingResearchAnalysis }) {
  const recentWeeks = research.weeks.slice(-8);
  return (
    <section
      className="itg2-card p-5 sm:p-6 min-[801px]:col-span-2"
      aria-label="Backtesting research"
    >
      <p className="itg2-eyebrow">Research</p>
      <h2 className="itg2-section-title mt-1">Backtesting research</h2>
      <p className="mt-1 max-w-[720px] text-xs leading-relaxed text-muted-foreground">
        What your recorded research activity shows — and what it cannot. ITG logs
        backtesting as a daily session count: that you backtested, not what you
        tested or what it showed. No strategy, pair or result is stored for a
        session, so backtest performance cannot be compared with live performance
        here, and no result is ever invented. What the record does support is the
        activity itself, and how it lines up with your live trading.
      </p>
      {research.status !== "ok" ? (
        <p className="mt-3 max-w-[720px] text-muted-foreground">
          No backtesting sessions recorded yet — so there is no research record to
          analyse. Sessions are logged on the Coach page: just a date and how many
          sessions you completed that day, at +15 XP each. Once you log them, this
          panel tracks the activity and how it lines up with your live trades.
        </p>
      ) : (
        <div className="mt-3">
          <StatRow label="Sessions recorded">
            {research.totalSessions} over {research.activeDays} day
            {research.activeDays === 1 ? "" : "s"}
            {research.firstSessionDate && research.lastSessionDate
              ? research.firstSessionDate === research.lastSessionDate
                ? ` — ${research.firstSessionDate}`
                : ` — ${research.firstSessionDate} to ${research.lastSessionDate}`
              : ""}
          </StatRow>
          <StatRow label="Sessions in the last 28 days">{research.recentSessions}</StatRow>
          <StatRow label="Weeks with recorded research">{research.activeWeeks}</StatRow>

          <h3 className="mt-4 text-sm font-semibold">Preparation and live trading</h3>
          {research.liveTradesCount === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No closed live trades yet — nothing to line the research record up
              against.
            </p>
          ) : (
            <>
              <StatRow label="Closed trades within 7 days of a recorded session">
                {research.preparedTrades} of {research.liveTradesCount}
                {research.preparationPct !== null
                  ? ` (${research.preparationPct.toFixed(0)}%)`
                  : ""}
              </StatRow>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                A trade counts when a backtesting session was recorded in the
                7 days up to and including the day it closed; sessions recorded
                after a trade closed never count towards it. This describes your
                recorded routine only — it is not evidence that backtesting
                caused any result.
              </p>
            </>
          )}

          {recentWeeks.length > 0 ? (
            <>
              <h3 className="mt-4 text-sm font-semibold">Week by week</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="itg2-table itg2-table-fit">
                  <thead>
                    <tr>
                      <th>Week starting</th>
                      <th>Sessions</th>
                      <th>Live trades closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentWeeks.map((w) => (
                      <tr key={w.weekStart}>
                        <td className="font-medium tabular-nums">{w.weekStart}</td>
                        <td className="tabular-nums">{w.sessions}</td>
                        <td className="tabular-nums">{w.liveTrades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {research.weeks.length > recentWeeks.length ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the most recent {recentWeeks.length} of{" "}
                  {research.weeks.length} weeks with recorded research or closed
                  trades.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function IntelligenceSection({ data }: { data: IntelligenceOverview }) {
  const { patterns, drawdown, risk, psychology, discipline, recurring, conditions, marketConditions, backtestingResearch, plan } = data;
  return (
    <div className="mt-10">
      <p className="itg2-eyebrow">Intelligence</p>
      <h2 className="itg2-section-title mt-1">Advanced intelligence</h2>
      <p className="mt-2 max-w-[720px] text-sm leading-relaxed text-muted-foreground">
        Deeper reads over the same real trades — patterns, drawdown, risk behaviour,
        psychology, discipline, conditions and a personalized improvement plan. Where
        a sample is too small to conclude, the panel says so instead of guessing.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-[18px] min-[801px]:grid-cols-2">
        <PatternsCard patterns={patterns} />
        <MarketConditionsCard conditions={marketConditions} />
        <BacktestingResearchCard research={backtestingResearch} />
        <section className="itg2-card p-5 sm:p-6" aria-label="Drawdown analysis">
          <p className="itg2-eyebrow">Risk</p>
          <h2 className="itg2-section-title mt-1">Drawdown analysis</h2>
          {drawdown.status !== "ok" ? (
            <p className="mt-2 text-muted-foreground">
              {data.tradesCount} closed trades recorded — a drawdown analysis needs at least 5.
            </p>
          ) : (
            <div className="mt-3">
              <StatRow label="Maximum drawdown">
                {formatMoney(drawdown.maxDrawdown)}
                {drawdown.maxDrawdownPctOfPeak !== null
                  ? ` (${drawdown.maxDrawdownPctOfPeak.toFixed(1)}% of peak profit)`
                  : ""}
              </StatRow>
              {drawdown.episode ? (
                <>
                  <StatRow label="Worst episode">
                    {drawdown.episode.peakDate} → {drawdown.episode.troughDate}
                  </StatRow>
                  <StatRow label="Recovered">
                    {drawdown.episode.recovered
                      ? `Yes — ${drawdown.episode.recoveryDate}`
                      : "Not yet"}
                  </StatRow>
                </>
              ) : null}
              {drawdown.longestUnderwater ? (
                <StatRow label="Longest time underwater">
                  {drawdown.longestUnderwater.trades} trades · {drawdown.longestUnderwater.days} days
                </StatRow>
              ) : null}
              <StatRow label="Current drawdown">
                {drawdown.atPeak ? "At peak" : formatMoney(drawdown.currentDrawdown)}
              </StatRow>
              <div className="itg2-chart-pool mt-4">
                <DrawdownChart data={drawdown.series.map((p) => ({ date: p.date, drawdown: p.drawdown }))} />
              </div>
            </div>
          )}
        </section>

        <section className="itg2-card p-5 sm:p-6" aria-label="Risk behaviour">
          <p className="itg2-eyebrow">Risk</p>
          <h2 className="itg2-section-title mt-1">Risk behaviour</h2>
          {risk.status !== "ok" ? (
            <p className="mt-2 text-muted-foreground">No closed trades yet — nothing to measure.</p>
          ) : (
            <div className="mt-3">
              {risk.distribution ? (
                <>
                  <StatRow label="Average planned risk">{formatMoney(risk.distribution.avg)}</StatRow>
                  <StatRow label="Median / largest planned risk">
                    {formatMoney(risk.distribution.median)} / {formatMoney(risk.distribution.max)}
                  </StatRow>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No closed trade has a stop-loss recorded, so planned risk cannot be measured.
                </p>
              )}
              {risk.overLimitCount !== null ? (
                <StatRow label="Trades over the per-trade limit">
                  {risk.overLimitCount} of {risk.withRiskCount}
                  {risk.withinLimitPct !== null ? ` (${risk.withinLimitPct.toFixed(0)}% inside)` : ""}
                </StatRow>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {risk.riskLimitNote === "capital_missing"
                    ? "A per-trade risk limit is configured, but no trading capital is on your profile to measure it against."
                    : "No per-trade risk limit is configured in your risk rules or plan."}
                </p>
              )}
              {risk.worstDay ? (
                <StatRow label="Worst day">
                  {formatMoney(risk.worstDay.pnl)} · {risk.worstDay.date}
                </StatRow>
              ) : null}
              {risk.dailyLossLimit !== null ? (
                <StatRow label="Days beyond the daily loss limit">{risk.dailyLossBreachDays ?? 0}</StatRow>
              ) : null}
              {risk.trend ? (
                <StatRow label="Planned risk trend">
                  {formatMoney(risk.trend.priorAvg)} → {formatMoney(risk.trend.recentAvg)}
                </StatRow>
              ) : null}
              {risk.riskEvents.total > 0 ? (
                <StatRow label="Stored risk events">
                  {risk.riskEvents.total} ({risk.riskEvents.critical} critical · {risk.riskEvents.last30Days} in 30 days)
                </StatRow>
              ) : null}
              <StatRow label="Longest losing streak">{risk.maxConsecutiveLosses} trades</StatRow>
            </div>
          )}
        </section>

        <section className="itg2-card p-5 sm:p-6" aria-label="Psychology and performance">
          <p className="itg2-eyebrow">Psychology</p>
          <h2 className="itg2-section-title mt-1">Psychology ↔ performance</h2>
          {psychology.status !== "ok" ? (
            <p className="mt-2 text-muted-foreground">
              No psychology records yet — add emotion and confidence in a trade&apos;s advanced review.
            </p>
          ) : (
            <div className="mt-3">
              <GroupTable rows={psychology.byEmotion} />
              {psychology.emotionStatement ? (
                <p className="mt-3 text-sm text-muted-foreground">{psychology.emotionStatement}</p>
              ) : null}
              {psychology.byConfidence.length > 0 ? (
                <>
                  <h3 className="mt-4 text-sm font-semibold">By confidence</h3>
                  <GroupTable rows={psychology.byConfidence} />
                </>
              ) : null}
              {psychology.confidenceStatement ? (
                <p className="mt-3 text-sm text-muted-foreground">{psychology.confidenceStatement}</p>
              ) : null}
            </div>
          )}
        </section>

        <section className="itg2-card p-5 sm:p-6" aria-label="Discipline and performance">
          <p className="itg2-eyebrow">Discipline</p>
          <h2 className="itg2-section-title mt-1">Discipline ↔ performance</h2>
          {discipline.status !== "ok" ? (
            <p className="mt-2 text-muted-foreground">No closed trades yet — nothing to measure.</p>
          ) : (
            <div className="mt-1">
              <p className="mt-2 text-sm text-muted-foreground">
                Stop-loss set on {discipline.stopLossPct.toFixed(0)}% · Journal completion{" "}
                {discipline.journalCompletionPct.toFixed(0)}%
              </p>
              <SplitBlock title="Stop-loss" split={discipline.stopLoss} />
              {discipline.rating ? <SplitBlock title="Discipline rating" split={discipline.rating} /> : null}
              <SplitBlock title="Journaling" split={discipline.journaled} />
            </div>
          )}
        </section>

        <section className="itg2-card p-5 sm:p-6" aria-label="Best and worst conditions">
          <p className="itg2-eyebrow">Strategy</p>
          <h2 className="itg2-section-title mt-1">Best / worst conditions</h2>
          {conditions.status !== "ok" ? (
            <p className="mt-2 text-muted-foreground">
              No session/direction, strategy/session or market-condition group has 3 or more trades yet.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="itg2-table itg2-table-fit">
                <thead>
                  <tr>
                    <th>Condition</th>
                    <th>Trades</th>
                    <th>P&amp;L</th>
                    <th>Expectancy</th>
                  </tr>
                </thead>
                <tbody>
                  {conditions.rows.map((r) => (
                    <tr key={`${r.dimension}-${r.key}`}>
                      <td className="font-medium">
                        {r.label}
                        {conditions.best && r.key === conditions.best.key && r.dimension === conditions.best.dimension ? (
                          <span className="itg2-chip itg2-chip-profit ml-2 whitespace-nowrap">Best</span>
                        ) : null}
                        {conditions.worst && r.key === conditions.worst.key && r.dimension === conditions.worst.dimension ? (
                          <span className="itg2-chip itg2-chip-loss ml-2 whitespace-nowrap">Worst</span>
                        ) : null}
                      </td>
                      <td className="tabular-nums">{r.trades}</td>
                      <td><Money value={r.totalPnl} /></td>
                      <td>{r.expectancy === null ? "—" : formatMoney(r.expectancy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                Only groups with 3 or more trades are ranked — small samples are a lead to review, not proof of an edge.
              </p>
            </div>
          )}
        </section>

        <section className="itg2-card p-5 sm:p-6" aria-label="Recurring mistakes and setups">
          <p className="itg2-eyebrow">Discipline</p>
          <h2 className="itg2-section-title mt-1">Recurring mistakes &amp; setups</h2>
          {recurring.mistakes.length === 0 && recurring.losingSetups.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              Nothing repeats yet — no lesson text appears twice and no setup has lost twice.
            </p>
          ) : (
            <div className="mt-3">
              {recurring.mistakes.map((m) => (
                <div key={m.text} className="itg-stat-row">
                  <span className="itg-stat-row-label">
                    “{m.text}” · {m.count}×
                  </span>
                  <span className="itg-stat-row-value"><Money value={m.totalPnlImpact} /></span>
                </div>
              ))}
              {recurring.losingSetups.map((s) => (
                <div key={s.name} className="itg-stat-row">
                  <span className="itg-stat-row-label">
                    Setup: {s.name} · {s.losses} losses
                  </span>
                  <span className="itg-stat-row-value"><Money value={s.totalPnl} /></span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="itg2-card p-5 sm:p-6" aria-label="Improvement plan">
          <p className="itg2-eyebrow">Intelligence</p>
          <h2 className="itg2-section-title mt-1">Your improvement plan</h2>
          {plan.status !== "ok" ? (
            <p className="mt-2 text-muted-foreground">
              {data.tradesCount} closed trades recorded — a personalized plan needs at least 5.
            </p>
          ) : (
            <ol className="mt-3 space-y-4">
              {plan.actions.map((a, i) => (
                <li key={a.title} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <p className="text-sm font-semibold">
                    {i + 1}. {a.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{a.detail}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Evidence: {a.evidence}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <DigestCard digest={data.weeklyDigest} />
        <DigestCard digest={data.monthlyDigest} />
      </div>
    </div>
  );
}
