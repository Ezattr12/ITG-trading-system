import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Flame, Scale, Target, TrendingUp } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { displayOrNotProvided } from "@/lib/onboarding/completion";
import { formatMoney } from "@/lib/trades/calculations";
import { getAnalyticsBundle, type AnalyticsBundle } from "@/lib/analytics/queries";
import {
  buildEquityCurve,
  psychologySummary,
  summarizeTrades,
} from "@/lib/analytics/analytics";
import { EquityChart, EquitySparkline } from "@/components/analytics/charts";
import { Money } from "@/components/analytics/stat-card";
import { CountUpDecimal, CountUpMoney, CountUpPct } from "@/components/analytics/count-up";
import { ensureDisciplineReminderLogged } from "@/lib/discipline/actions";
import { getLatestCoachInsights } from "@/lib/coach/queries";
import { calcProfileCompletion } from "@/lib/profile/completion";
import { LevelRing } from "@/components/profile/level-ring";
import { progressToNextLevel } from "@/lib/gamification/scoring";
import { motivationContextFor, selectMotivationMessage } from "@/lib/discipline/motivation";
import {
  getLastJournalDate,
  getMotivationMessages,
  getNotifications,
} from "@/lib/discipline/queries";

export const metadata = { title: "Dashboard — ITG TraderOS" };

/**
 * Dashboard (Phase 4, spec §17). Computed from the trader's real
 * closed trades only — no demo trades, no fake P&L. With no trades
 * yet every stat shows "—" and an honest empty state; the AI
 * insights section shows the real latest coach insights (Phase 9)
 * or an honest empty state when none exist yet.
 *
 * v2 (Master Web UI Redesign, page 1): presentation only. The
 * page is rebuilt on the centralized .itg2-* glass system
 * (globals.css) — L3 hero with the identity band + P&L
 * headline, .itg2-kpi cards, the equity chart as the L2
 * centrepiece (restyled via the .itg2-chart-scope wrapper;
 * the shared EquityChart itself is untouched), and the one
 * violet AI surface. Every data call, value, link and aria
 * contract below is the pre-redesign behaviour, unchanged.
 */

const EMPTY_BUNDLE: AnalyticsBundle = {
  trades: [],
  goals: [],
  xpTotal: 0,
  xpHistory: [],
  levelName: null,
  levelScore: null,
  levels: [],
  dailyActivity: [],
};

/** KPI tone -> icon tile / status chip modifier (v2). The tone
 * is always derived from the real value in the page body. */
const KPI_ICON_TONE = {
  profit: " itg2-kpi-icon-profit",
  loss: " itg2-kpi-icon-loss",
  neutral: "",
} as const;
const KPI_CHIP_TONE = {
  profit: " itg2-chip-profit",
  loss: " itg2-chip-loss",
  neutral: "",
} as const;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const bundle = isSupabaseConfigured()
    ? await getAnalyticsBundle(await createServerSupabaseClient(), user.id)
    : EMPTY_BUNDLE;
  const summary = summarizeTrades(bundle.trades);
  const psych = psychologySummary(bundle.trades);
  const equity = buildEquityCurve(bundle.trades);

  let recentTrades: { id: string; pair: string; direction: string; opened_at: string; pnl: number | null; status: string }[] = [];
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    const { data: recent } = await supabase
      .from("trades")
      .select("id, pair, direction, opened_at, pnl, status")
      .eq("user_id", user.id)
      .order("opened_at", { ascending: false })
      .limit(5);
    recentTrades = (recent ?? []) as typeof recentTrades;
  }

  const bestEmotion = [...psych.byEmotion].sort((a, b) => b.pnl - a.pnl)[0];
  // Real level/XP (Phase 7): multi-dimensional score from the
  // trader's real trades and goals — not profit alone.
  const nextLevel = progressToNextLevel(bundle.levelScore, bundle.levels);
  // Real profile completion (Phase 19) for the completion ring.
  const profileCompletion = calcProfileCompletion({
    fullName: user.profile?.full_name,
    fatherName: user.profile?.father_name,
    dateOfBirth: user.profile?.date_of_birth,
    country: user.profile?.country,
    avatarUrl: user.profile?.avatar_url,
    tradingExperience: user.profile?.trading_experience,
    tradingEducation: user.profile?.trading_education,
    employmentStatus: user.profile?.employment_status,
  });
  const streakLabel =
    summary.currentStreak === 0
      ? "—"
      : summary.currentStreak > 0
        ? `${summary.currentStreak} wins in a row`
        : `${Math.abs(summary.currentStreak)} losses in a row`;

  // Discipline reminder (Phase 6): computed from the last journaled
  // day; logging is idempotent — the same level is never logged
  // twice — and a motivation message is picked for the moment.
  const today = new Date().toISOString().slice(0, 10);
  const lastJournalDate = isSupabaseConfigured()
    ? await getLastJournalDate(await createServerSupabaseClient(), user.id)
    : null;
  const reminder = isSupabaseConfigured()
    ? await ensureDisciplineReminderLogged(user.id, lastJournalDate, today)
    : { level: 0 as const, missedDays: 0, title: "", body: "" };
  const goalNearCompletion = bundle.goals.some(
    (g) => g.percent >= 80 && g.percent < 100,
  );
  const hadLossToday = bundle.trades.some(
    (t) => t.closedAt.slice(0, 10) === today && t.pnl < 0,
  );
  const motivationMessages = isSupabaseConfigured()
    ? await getMotivationMessages(await createServerSupabaseClient())
    : [];
  const latestInsights = isSupabaseConfigured()
    ? await getLatestCoachInsights(await createServerSupabaseClient(), user.id, 3)
    : [];
  const recentActivity = isSupabaseConfigured()
    ? await getNotifications(await createServerSupabaseClient(), user.id, 5)
    : [];
  const motivation = selectMotivationMessage(
    motivationMessages,
    motivationContextFor({
      missedDays: lastJournalDate === null ? null : reminder.missedDays,
      goalNearCompletion,
      disciplinedStreak: 0,
      hadLossToday,
    }),
    null,
    today,
  );

  // P&L hero value colour (Phase 19): follows the REAL cumulative
  // P&L — profit green when positive, loss red when negative,
  // neutral when there is nothing to judge yet (no trades, or
  // exactly break-even). The class is chosen from the value,
  // never hardcoded to a sign.
  const pnlValueClass =
    summary.tradeCount === 0 || summary.totalPnl === 0
      ? ""
      : summary.totalPnl > 0
        ? "itg-pnl-positive"
        : "itg-pnl-negative";
  // Value-driven KPI tones (v2, replacing the StatCard glows):
  // profit factor and average R are "profit" above break-even
  // and "loss" below it; the streak follows its real direction.
  // Null values stay neutral.
  const profitFactorTone =
    summary.profitFactor === null || summary.profitFactor === 1
      ? ("neutral" as const)
      : summary.profitFactor > 1
        ? ("profit" as const)
        : ("loss" as const);
  const avgRTone =
    summary.avgR === null || summary.avgR === 0
      ? ("neutral" as const)
      : summary.avgR > 0
        ? ("profit" as const)
        : ("loss" as const);
  const streakTone =
    summary.currentStreak > 0
      ? ("profit" as const)
      : summary.currentStreak < 0
        ? ("loss" as const)
        : ("neutral" as const);

  return (
    <AppShell email={user.email}>
      {/* 1. HERO (v2, L3 glass) — greeting + trader identity,
          the P&L performance headline, and the identity band
          (level / XP / profile completion) in one premium
          surface. Sections enter with a 60ms stagger
          (Phase 16) — the page settles in under half a
          second, then stays still. The decorative rings are
          pure CSS light (aria-hidden) — never data.
          Candlesticks are deliberately NOT rendered here:
          ITG has no market-data feed — the equity curve
          (real trade data) is the chart of record. */}
      <section className="itg2-hero motion-reveal" aria-label="Account overview">
        <div className="itg2-hero-rings" aria-hidden="true" />
        <div className="itg2-hero-inner p-5 sm:p-7">
          <div className="flex items-center gap-4">
            <div className="itg2-avatar" aria-hidden="true">
              {user.profile?.avatar_url ? (
                <img src={user.profile.avatar_url} alt="" />
              ) : (
                <span>
                  {(user.profile?.full_name ?? user.email ?? "T")
                    .charAt(0)
                    .toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="page-title">
                Welcome{user.profile?.full_name ? `, ${user.profile.full_name}` : ""}
              </h1>
              <p className="page-lede">
                {summary.tradeCount === 0
                  ? "No trades yet — add your first trade and your performance will be calculated from it."
                  : `${summary.tradeCount} closed trades journaled. All figures below are calculated from your real trades.`}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div className="min-w-0">
              <p className="itg2-eyebrow">Current P&amp;L</p>
              <p className={`itg2-hero-value mt-2 ${pnlValueClass}`}>
                {summary.tradeCount === 0 ? "—" : <CountUpMoney value={summary.totalPnl} />}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {summary.tradeCount === 0
                  ? "Cumulative P&L of closed trades — add your first trade and it will be calculated from it."
                  : `Cumulative P&L of ${summary.tradeCount} closed trades.`}
              </p>
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Closed trades</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums">{summary.tradeCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Wins</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums">{summary.wins}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Max drawdown</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums">
                    <Money value={summary.tradeCount === 0 ? null : summary.maxDrawdown} />
                  </dd>
                </div>
              </dl>
            </div>
            {equity.length > 0 ? (
              <div className="w-full shrink-0 sm:w-60 lg:w-80">
                <EquitySparkline data={equity} />
              </div>
            ) : null}
          </div>

          {/* Identity band — level (gold name), XP with its
              real level-band progress, and profile completion,
              all from the same computed values the Level & XP
              panel below presents in full. */}
          <div className="mt-6 grid grid-cols-1 gap-4 border-t border-white/10 pt-5 min-[420px]:grid-cols-3">
            <div>
              <p className="itg2-band-label">Level</p>
              <p className="itg2-band-value itg2-text-gold mt-1">
                {displayOrNotProvided(bundle.levelName)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {bundle.levelScore === null
                  ? "No score yet"
                  : `Score ${bundle.levelScore.toFixed(1)} / 100`}
              </p>
            </div>
            <div>
              <p className="itg2-band-label">Experience</p>
              <p className="itg2-band-value mt-1">{bundle.xpTotal} XP</p>
              <div
                className="itg2-progress itg2-progress-sm mt-2"
                role="progressbar"
                aria-valuenow={Math.round(nextLevel?.progressPct ?? 0)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress to the next level"
              >
                <div
                  className="itg2-progress-fill"
                  style={{ width: `${nextLevel?.progressPct ?? 0}%` }}
                />
              </div>
            </div>
            <div>
              <p className="itg2-band-label">Profile completion</p>
              <p className="itg2-band-value mt-1">{profileCompletion.percent}%</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {profileCompletion.missing.length === 0
                  ? "Complete — the ITG Verified Profile badge is active."
                  : `${profileCompletion.nextStep} to reach 100%.`}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. KPI row — the four supporting numbers as .itg2-kpi
          cards. Numeric KPIs count up over 700ms (Phase 16);
          a null still renders "—", never 0. Icon tiles and
          status chips follow the REAL value (see the tones
          above); win rate is a performance rate, so it keeps
          the neutral blue tile and no sign chip. */}
      <section className="motion-reveal motion-reveal-1 mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:grid-cols-4 sm:gap-4" aria-label="Key performance indicators">
        <article className="itg2-card itg2-kpi">
          <span className="itg2-kpi-icon" aria-hidden="true">
            <Target className="h-5 w-5" />
          </span>
          <h2 className="itg2-kpi-label mt-3">Win rate</h2>
          <p className="itg2-kpi-value">
            {summary.winRate === null ? "—" : <CountUpPct value={summary.winRate} />}
          </p>
          <p className="itg2-kpi-hint">{`${summary.wins} wins · ${summary.losses} losses`}</p>
        </article>
        <article className="itg2-card itg2-kpi">
          <span className={`itg2-kpi-icon${KPI_ICON_TONE[profitFactorTone]}`} aria-hidden="true">
            <TrendingUp className="h-5 w-5" />
          </span>
          <h2 className="itg2-kpi-label mt-3">Profit factor</h2>
          <p className="itg2-kpi-value">
            {summary.profitFactor === null ? "—" : <CountUpDecimal value={summary.profitFactor} decimals={2} />}
          </p>
          <p className="itg2-kpi-hint">
            {summary.profitFactor === null ? "Needs at least one losing trade to calculate." : "Gross profit ÷ gross loss."}
          </p>
          {summary.profitFactor !== null && summary.profitFactor !== 1 ? (
            <div className="mt-3">
              <span className={`itg2-chip${KPI_CHIP_TONE[profitFactorTone]}`}>
                {summary.profitFactor > 1 ? "Above break-even" : "Below break-even"}
              </span>
            </div>
          ) : null}
        </article>
        <article className="itg2-card itg2-kpi">
          <span className={`itg2-kpi-icon${KPI_ICON_TONE[avgRTone]}`} aria-hidden="true">
            <Scale className="h-5 w-5" />
          </span>
          <h2 className="itg2-kpi-label mt-3">Average R</h2>
          <p className="itg2-kpi-value">
            {summary.avgR === null ? "—" : <CountUpDecimal value={summary.avgR} decimals={2} suffix="R" />}
          </p>
          <p className="itg2-kpi-hint">Average R multiple (needs a stop-loss set).</p>
          {summary.avgR !== null && summary.avgR !== 0 ? (
            <div className="mt-3">
              <span className={`itg2-chip${KPI_CHIP_TONE[avgRTone]}`}>
                {summary.avgR > 0 ? "Positive expectancy" : "Negative expectancy"}
              </span>
            </div>
          ) : null}
        </article>
        <article className="itg2-card itg2-kpi col-span-2 sm:col-span-1">
          <span className={`itg2-kpi-icon${KPI_ICON_TONE[streakTone]}`} aria-hidden="true">
            <Flame className="h-5 w-5" />
          </span>
          <h2 className="itg2-kpi-label mt-3">Current streak</h2>
          <p className="itg2-kpi-value">{streakLabel}</p>
          <p className="itg2-kpi-hint">
            {summary.tradeCount === 0 ? "No closed trades yet." : "Consecutive wins or losses."}
          </p>
          {summary.currentStreak !== 0 ? (
            <div className="mt-3">
              <span className={`itg2-chip${KPI_CHIP_TONE[streakTone]}`}>
                {summary.currentStreak > 0 ? "Winning streak" : "Losing streak"}
              </span>
            </div>
          ) : null}
        </article>
      </section>

      {/* 3. Main performance / equity curve — the visual
          centrepiece, on the L2 elevated glass. The shared
          EquityChart is restyled only through the
          .itg2-chart-scope wrapper (deep-blue pool, blue ->
          cyan line and fill); its data and its Analytics
          appearance are unchanged. */}
      <section className="itg2-card-elevated motion-reveal motion-reveal-2 mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Performance chart">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="itg2-eyebrow">Equity</p>
            <h2 className="itg2-section-title mt-1">Performance</h2>
          </div>
          {equity.length > 0 ? (
            <div className="text-right">
              <p className={`itg2-figure ${pnlValueClass}`}>
                <CountUpMoney value={summary.totalPnl} />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cumulative P&amp;L · {summary.tradeCount} closed trades
              </p>
            </div>
          ) : null}
        </div>
        {equity.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">
            Your equity curve will appear here once you close your first trade.
          </p>
        ) : (
          <>
            <div className="itg2-chart-scope mt-4">
              <EquityChart data={equity} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Cumulative P&L of closed trades, in close order. Starting capital is not stored, so the curve starts at 0.
            </p>
          </>
        )}
      </section>

      {/* 4. Risk & discipline + 5. Level, XP and goals. */}
      <section className="motion-reveal motion-reveal-3 mt-6 grid gap-4 sm:mt-8 lg:grid-cols-2" aria-label="Risk, discipline and goals">
        <article className="itg2-card p-4 sm:p-6">
          <p className="itg2-eyebrow">Risk</p>
          <h2 className="itg2-section-title mt-1">Risk &amp; discipline</h2>
          <ul className="mt-3 space-y-2 text-base">
            <li>Stop-loss set on <strong>{psych.stopLossPct.toFixed(0)}%</strong> of closed trades</li>
            <li>Discipline rated “Good” on <strong>{psych.goodDisciplinePct === null ? "—" : `${psych.goodDisciplinePct.toFixed(0)}%`}</strong> of rated trades</li>
            <li>Journal completion: <strong>{psych.journalCompletionPct.toFixed(0)}%</strong> of closed trades have psychology or a lesson</li>
            <li>Max drawdown: <strong><Money value={summary.tradeCount === 0 ? null : summary.maxDrawdown} /></strong></li>
          </ul>
          {reminder.level > 0 ? (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <p className="font-medium">{reminder.title}</p>
              <p className="page-lede">{reminder.body}</p>
            </div>
          ) : (
            <p className="mt-4 text-base text-muted-foreground">
              {lastJournalDate === null
                ? "No journal entries yet — your first reviewed trade starts your discipline streak."
                : "You're up to date with your journaling. Keep it going."}
            </p>
          )}
          {motivation ? (
            <p className="mt-3 text-sm italic text-muted-foreground">“{motivation.message}”</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/risk" className="itg2-link">Risk rules</Link>
            <Link href="/notifications" className="itg2-link">Notifications</Link>
          </div>
        </article>

        {/* Level & XP + profile completion. The ring fill
            (--itg-ring-pct), the XP track (--xp-progress) and
            the completion ring (--completion) are all set
            inline from the REAL computed values — level-band
            progress %, profile completion % — never hardcoded.
            Inside .itg2-level-scope their fills render
            blue -> cyan (globals.css); the shared components
            are unchanged everywhere else. Level is the
            multi-dimensional score (Bronze/Silver/Gold/
            Platinum), not profit alone. */}
        <article className="itg2-card itg2-level-scope p-4 sm:p-6">
          <p className="itg2-eyebrow">Progress</p>
          <h2 className="itg2-section-title mt-1">Level &amp; XP</h2>
          <div className="mt-4 flex items-center gap-5">
            <LevelRing
              progressPct={nextLevel?.progressPct ?? 0}
              levelName={bundle.levelName}
              score={bundle.levelScore}
            />
            <div className="min-w-0">
              <p className="text-xl font-bold itg2-text-gold">{displayOrNotProvided(bundle.levelName)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {bundle.levelScore === null
                  ? "No score yet — journal a trade to start building your level."
                  : `Score ${bundle.levelScore.toFixed(1)} / 100`}
              </p>
              <p className="itg-xp mt-1 text-sm font-semibold">{bundle.xpTotal} XP total</p>
            </div>
          </div>
          <div
            className="itg-xp-track mt-4"
            style={{ "--xp-progress": `${nextLevel?.progressPct ?? 0}%` } as CSSProperties}
            role="progressbar"
            aria-valuenow={Math.round(nextLevel?.progressPct ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress to the next level"
          >
            <div className="itg-xp-fill" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {nextLevel === null
              ? "Journal trades to earn a level."
              : nextLevel.nextLevel === null
                ? "Top level reached."
                : `${nextLevel.pointsToNext} points to ${nextLevel.nextLevel} · Scored on discipline, risk, journaling, goals, psychology, strategy, consistency and performance — not profit alone.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/levels" className="itg2-link">Level &amp; score breakdown</Link>
            <Link href="/achievements" className="itg2-link">Achievements</Link>
          </div>

          <div className="mt-5 flex items-center gap-5 border-t border-white/10 pt-5">
            <div
              className="itg-completion-ring shrink-0"
              style={{ "--completion": `${profileCompletion.percent}%` } as CSSProperties}
              role="img"
              aria-label={`Profile ${profileCompletion.percent}% complete`}
            >
              <div className="itg-completion-ring-content">
                <span className="tnum text-lg font-bold leading-none">{profileCompletion.percent}%</span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="font-semibold">Profile completion</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {profileCompletion.missing.length === 0
                  ? "Your profile is complete — the ITG Verified Profile badge is active."
                  : `${profileCompletion.nextStep} to reach 100%.`}
              </p>
              <Link href="/profile" className="itg2-link mt-1">Open your profile</Link>
            </div>
          </div>

          <h3 className="mt-5 text-sm font-semibold">Goals</h3>
          {bundle.goals.length > 0 ? (
            <div className="mt-3 space-y-3">
              {bundle.goals.slice(0, 3).map((g) => {
                const shown = Math.min(100, Math.max(0, g.percent));
                const label = `${g.title}: ${g.currentValue} / ${g.targetValue} (${g.percent.toFixed(0)}%)`;
                return (
                  <div key={g.id}>
                    <div
                      className="itg2-progress"
                      role="progressbar"
                      aria-valuenow={Math.round(shown)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={label}
                    >
                      <div
                        className="itg2-progress-fill"
                        style={{ width: `${shown}%` }}
                      />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{label}</p>
                  </div>
                );
              })}
              <Link href="/progress" className="itg2-link">
                View all goals and progress
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-base text-muted-foreground">
              No goals yet.{" "}
              <Link href="/goals" className="font-medium underline">
                Create your first goal
              </Link>{" "}
              — for now, journaling builds your XP.
            </p>
          )}
        </article>
      </section>

      {/* 6. Psychology. */}
      <section className="motion-reveal motion-reveal-4 itg2-card mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Psychology">
        <p className="itg2-eyebrow">Mindset</p>
        <h2 className="itg2-section-title mt-1">Psychology</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="section-label">Average confidence</p>
            <p className="metric-value">{psych.avgConfidence === null ? "—" : <CountUpDecimal value={psych.avgConfidence} decimals={1} suffix=" / 5" />}</p>
          </div>
          <div>
            <p className="section-label">Best emotion by P&amp;L</p>
            <p className="metric-value">{bestEmotion ? bestEmotion.emotion : "—"}</p>
            {bestEmotion ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {formatMoney(bestEmotion.pnl)} over {bestEmotion.trades} trades
              </p>
            ) : null}
          </div>
          <div>
            <p className="section-label">Journal completion</p>
            <p className="metric-value"><CountUpDecimal value={psych.journalCompletionPct} decimals={0} suffix="%" /></p>
          </div>
        </div>
        {psych.byEmotion.length > 0 ? (
          <ul className="mt-4 space-y-2 text-base">
            {[...psych.byEmotion].sort((a, b) => b.trades - a.trades).slice(0, 4).map((row) => (
              <li key={row.emotion} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <span className="capitalize">{row.emotion} · {row.trades} trades</span>
                <span className={row.pnl > 0 ? "font-medium itg2-text-profit" : row.pnl < 0 ? "font-medium itg2-text-loss" : ""}>
                  {formatMoney(row.pnl)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/psychology" className="itg2-link mt-4">
          Full psychology breakdown
        </Link>
      </section>

      {/* 7. Recent trades — premium glass rows: pair, a
          direction chip (Long green / Short red, from the
          real direction), date, and the semantic P&L. */}
      <section className="motion-reveal motion-reveal-5 itg2-card mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Recent trades">
        <p className="itg2-eyebrow">Journal</p>
        <h2 className="itg2-section-title mt-1">Recent trades</h2>
        {recentTrades.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">No trades yet.</p>
        ) : (
          <ul className="list-divider mt-1 text-base">
            {recentTrades.map((t) => {
              const dir = t.direction.toLowerCase();
              const dirChip =
                dir === "short"
                  ? " itg2-chip-loss"
                  : dir === "long"
                    ? " itg2-chip-profit"
                    : "";
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                  <Link href={`/trades/${t.id}`} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{t.pair}</span>
                    <span className={`itg2-chip itg2-chip-dir${dirChip}`}>{t.direction}</span>
                    <span className="text-sm text-muted-foreground">
                      {new Date(t.opened_at).toLocaleDateString()}
                    </span>
                  </Link>
                  <span className={t.pnl === null ? "" : t.pnl > 0 ? "font-medium itg2-text-profit" : t.pnl < 0 ? "font-medium itg2-text-loss" : ""}>
                    {t.status === "open" ? "Open" : formatMoney(t.pnl)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/trades/new" className="itg2-link">Add a trade</Link>
          <Link href="/trades" className="itg2-link">View all trades</Link>
          <Link href="/calendar" className="itg2-link">Trading calendar</Link>
        </div>
      </section>

      {/* 8. AI Coach insights — the one violet surface on the
          dashboard, marking the AI identity: black-blue glass,
          a violet glow edge and the CSS orb. */}
      <section className="motion-reveal motion-reveal-6 itg2-card itg2-card-ai mt-6 p-4 sm:mt-8 sm:p-6" aria-label="AI insights">
        <div className="flex items-center gap-3">
          <span className="itg2-ai-orb" aria-hidden="true">
            <span className="itg2-ai-orb-dot motion-ai-dot" />
          </span>
          <div>
            <p className="itg2-eyebrow itg2-eyebrow-ai">AI Coach</p>
            <h2 className="itg2-section-title mt-0.5">AI Coach insights</h2>
          </div>
        </div>
        {latestInsights.length === 0 ? (
          <p className="mt-3 text-base text-muted-foreground">
            No coach insights yet — the AI Coach analyses your real trades once you have at
            least 3 closed trades in a week. Nothing here is generated or estimated.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-base">
            {latestInsights.map((insight) => (
              <li key={insight.id}>
                <span className="font-medium">{insight.summary}</span>
                <span className="text-muted-foreground">
                  {" — "}
                  {insight.metrics_snapshot.recommendation}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/coach" className="itg2-btn-ai mt-4">
          Open AI Coach
        </Link>
      </section>

      {/* 9. Recent activity — real notifications only, never invented. */}
      <section className="motion-reveal motion-reveal-6 itg2-card mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Recent activity">
        <p className="itg2-eyebrow">Activity</p>
        <h2 className="itg2-section-title mt-1">Recent activity</h2>
        {recentActivity.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">
            No activity yet — achievements, risk milestones and coach insights will appear here as they happen.
          </p>
        ) : (
          <ul className="list-divider mt-1 text-base">
            {recentActivity.map((n) => (
              <li key={n.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3">
                <span className="font-medium">{n.title}</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(n.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/notifications" className="itg2-link mt-4">
          All notifications
        </Link>
      </section>
    </AppShell>
  );
}
