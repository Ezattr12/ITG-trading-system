import { redirect } from "next/navigation";
import Link from "next/link";
import { Pencil, ShieldCheck, Trophy, Check } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { displayOrNotProvided } from "@/lib/onboarding/completion";
import {
  calcProfileCompletion,
  type ProfileCompletionRow,
} from "@/lib/profile/completion";
import {
  bestStrategy,
  identityMarkets,
  identitySessions,
  mostUsedStrategy,
  sessionLabel,
} from "@/lib/profile/identity";
import { getGamificationBundle } from "@/lib/gamification/queries";
import { getRiskRules, getTradingPlan } from "@/lib/risk/queries";
import { progressToNextLevel } from "@/lib/gamification/scoring";
import { summarizeTrades } from "@/lib/analytics/analytics";
import { AvatarDisplay } from "@/components/profile/avatar-display";
import { LevelRing } from "@/components/profile/level-ring";
import { CountUpXp } from "@/components/analytics/count-up";

export const metadata = { title: "Profile — ITG TraderOS" };

/**
 * An all-empty stored row, used when there is no profile row yet
 * (e.g. Supabase not connected): completion is honestly 0%.
 */
const EMPTY_PROFILE_ROW: ProfileCompletionRow = {
  full_name: null,
  father_name: null,
  date_of_birth: null,
  country: null,
  avatar_url: null,
  trading_experience: null,
  trading_education: null,
  employment_status: null,
};

/**
 * Profile-completion ring geometry (aside card): an SVG
 * circle of radius 52 in a 120 viewBox; the progress arc's
 * dash offset is derived from the real completion percent.
 */
const COMPLETION_RING_RADIUS = 52;
const COMPLETION_RING_CIRCUMFERENCE = 2 * Math.PI * COMPLETION_RING_RADIUS;

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="itg2-row">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * Premium trader profile (Master Web UI Redesign — Page 7:
 * the v2 glass system in itg2.css, deep black / deep blue /
 * white, violet reserved for AI surfaces only).
 *
 * Read-only overview (Profile UI/UX Correction, Ezat
 * 2026-11-05): a hero glass card (display-only photo, name
 * with the completeness badge beside it at 100%, level ring,
 * XP + level progress), then key stats, Trading Identity,
 * achievements and the completion panel. Editing lives on
 * the dedicated /profile/edit page (Edit Profile button,
 * top-right of the hero); this page renders no form fields
 * and the hero photo is not a control. Everything shown
 * comes from real stored data:
 * - Level: the existing multi-dimensional score
 *   (ten competency bands, spec §8 / Task 22) — the level of
 *   record. There is no XP-based "Level 7" ladder in this
 *   product; XP is displayed as accumulated XP, and the bar
 *   shows progress through the current level's score band.
 * - "ITG Verified Profile": a profile-completeness badge,
 *   computed from the stored profile row (100% of the 8
 *   required items). It is NOT identity/KYC verification —
 *   the admin-reviewed verification_status is shown
 *   separately in Trading Identity.
 * - Achievements: only earned ones are shown on this page;
 *   the full set, locked included, lives on /achievements.
 *   Statistics: real trade calculations. Empty states stay
 *   honest ("Not Provided").
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = user.profile;
  const configured = isSupabaseConfigured();

  // The ONE canonical calculator (@itg/calc) reads the stored
  // row directly — no per-surface field mapping to drift.
  const completion = calcProfileCompletion(p ?? EMPTY_PROFILE_ROW);

  let bundle: Awaited<ReturnType<typeof getGamificationBundle>> | null = null;
  let plan: Awaited<ReturnType<typeof getTradingPlan>> = null;
  let rules: Awaited<ReturnType<typeof getRiskRules>> = null;
  let certificates: {
    certificate_id: string;
    month: string | null;
    kind: string | null;
    level_name: string | null;
  }[] = [];
  if (configured && p) {
    const supabase = await createServerSupabaseClient();
    const [b, pl, r, { data: certs }] = await Promise.all([
      getGamificationBundle(supabase, user.id),
      getTradingPlan(supabase, user.id),
      getRiskRules(supabase, user.id),
      supabase
        .from("certificates")
        .select("certificate_id, month, kind, level_name")
        .eq("user_id", user.id)
        .order("month", { ascending: false }),
    ]);
    bundle = b;
    plan = pl;
    rules = r;
    certificates = (certs ?? []) as {
      certificate_id: string;
      month: string | null;
      kind: string | null;
      level_name: string | null;
    }[];
  }

  const summary = bundle ? summarizeTrades(bundle.trades) : null;
  const progress = bundle ? progressToNextLevel(bundle.score.score, bundle.levels) : null;
  const levelName = bundle?.score.levelName ?? null;
  const xpTotal = bundle?.xpTotal ?? 0;
  const best = bundle ? bestStrategy(bundle.trades) : null;
  const primaryStrategy = bundle ? mostUsedStrategy(bundle.trades) : null;
  const markets = identityMarkets(plan?.markets, bundle?.trades ?? []);
  const sessions = identitySessions(plan?.sessions, bundle?.trades ?? []);
  const unlockedIds = new Set((bundle?.userAchievements ?? []).map((u) => u.achievement_id));
  const unlockedAt = new Map(
    (bundle?.userAchievements ?? []).map((u) => [u.achievement_id, u.unlocked_at]),
  );
  const earned = (bundle?.achievements ?? []).filter((a) => unlockedIds.has(a.id));

  const verificationLabel =
    p?.verification_status === "verified"
      ? "Verified"
      : p?.verification_status === "partial"
        ? "Partially verified"
        : "Not provided";
  const streak = summary?.currentStreak ?? 0;
  const streakLabel =
    summary === null || summary.tradeCount === 0
      ? "No trades yet"
      : streak === 0
        ? "No current streak"
        : streak > 0
          ? `${streak} wins in a row`
          : `${Math.abs(streak)} losses in a row`;

  return (
    <AppShell email={user.email}>
      <p className="itg2-eyebrow">Trader profile</p>
      {!configured && (
        <p role="alert" className="itg2-notice itg2-notice-warning mt-4">
          {supabaseNotConnectedMessage()}
        </p>
      )}

      {/* Hero (v2, L3 glass) — photo in its gradient ring,
          name, completeness badge, level ring, XP + level
          progress, in the dashboard hero's layout language. */}
      <section className="itg2-hero motion-reveal mt-4 sm:mt-6" aria-label="Trader profile">
        <div className="itg2-hero-rings" aria-hidden="true" />
        <div className="itg2-hero-inner p-5 sm:p-7">
        <div className="mb-4 flex justify-end">
          <Link href="/profile/edit" className="itg2-btn-ghost">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit Profile
          </Link>
        </div>
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:gap-8 sm:text-left">
          <AvatarDisplay
            avatarUrl={p?.avatar_url ?? null}
            name={p?.full_name ?? user.email ?? "Trader"}
          />
          <div className="min-w-0 flex-1">
            <h1 className="itg2-page-title">
              {displayOrNotProvided(p?.full_name)}
              {completion.verified && (
                <span className="itg2-verified ml-3 align-middle text-sm">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  ITG Verified Profile
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {p?.role === "admin" ? "Admin" : "Professional Trader"}
              {p?.country ? ` · ${p.country}` : ""}
            </p>
            {!completion.verified && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <Link href="#profile-completion" className="itg2-chip itg2-chip-lg">
                  Profile {completion.percent}% complete
                  <span className="text-muted-foreground">· {completion.nextStep}</span>
                </Link>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <LevelRing
              progressPct={progress?.progressPct ?? 0}
              levelName={levelName}
              score={bundle?.score.score ?? null}
            />
            <p className="text-xs text-muted-foreground">
              {levelName === null ? "No level yet" : `${levelName} level`}
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="itg2-hero-value">
                <CountUpXp value={xpTotal} />
              </p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                {bundle === null ? "— connect Supabase to load XP" : "total XP earned"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {progress === null
                ? "Journal trades to earn a level"
                : progress.nextLevel === null
                  ? "Top level reached"
                  : `${progress.pointsToNext} points to ${progress.nextLevel}`}
            </p>
          </div>
          <div
            className="itg2-progress mt-3"
            role="progressbar"
            aria-valuenow={Math.round(progress?.progressPct ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress to the next level"
          >
            <div className="itg2-progress-fill" style={{ width: `${progress?.progressPct ?? 0}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Your level is scored on discipline, risk, journaling, goals, psychology, strategy,
            consistency and performance — not profit alone.{" "}
            <Link href="/levels" className="font-medium text-foreground underline">
              How levels work
            </Link>
          </p>
        </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Key stats — real trade calculations only. */}
          <section className="motion-reveal" aria-label="Key statistics">
            <h2 className="itg2-section-title">Key stats</h2>
            {summary === null ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Statistics will appear once Supabase is connected and you have trades. Nothing here is estimated.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <article className="itg2-card itg2-kpi">
                  <p className="itg2-kpi-label">Total trades</p>
                  <p className="itg2-kpi-value">{summary.tradeCount}</p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <p className="itg2-kpi-label">Win rate</p>
                  <p className={`itg2-kpi-value ${summary.winRate !== null && summary.winRate >= 50 ? "itg2-text-profit" : ""}`}>
                    {summary.winRate === null ? "—" : `${Math.round(summary.winRate)}%`}
                  </p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <p className="itg2-kpi-label">Profit factor</p>
                  <p className="itg2-kpi-value">
                    {summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}
                  </p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <p className="itg2-kpi-label">Average R</p>
                  <p className="itg2-kpi-value">
                    {summary.avgR === null ? "—" : summary.avgR.toFixed(2)}
                  </p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <p className="itg2-kpi-label">Best strategy</p>
                  <p className="itg2-kpi-value truncate">
                    {best === null ? "Not provided" : best.name}
                  </p>
                  <p className="itg2-kpi-hint">
                    {best === null
                      ? "Needs 3+ trades on one strategy"
                      : `Win rate ${Math.round(best.winRate)}% · ${best.trades} trades`}
                  </p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <p className="itg2-kpi-label">Current streak</p>
                  <p className="itg2-kpi-value">{streakLabel}</p>
                  <p className="itg2-kpi-hint">
                    {summary.tradeCount === 0 ? "Journal your first trade" : `${summary.wins} wins · ${summary.losses} losses`}
                  </p>
                </article>
              </div>
            )}
          </section>

          {/* Trading Identity — only fields that actually exist. */}
          <section className="motion-reveal itg2-card p-5 sm:p-6" aria-label="Trading identity">
            <div className="flex items-center justify-between gap-4">
              <h2 className="itg2-section-title">Trading Identity</h2>
              <Link href="/profile/edit" className="itg2-link">
                Edit
              </Link>
            </div>
            <dl className="mt-2">
              <IdentityRow label="Experience" value={displayOrNotProvided(p?.trading_experience)} />
              <IdentityRow
                label="Markets"
                value={markets.length > 0 ? markets.join(", ") : "Not provided"}
              />
              <IdentityRow
                label="Primary strategy"
                value={primaryStrategy ?? "Not provided"}
              />
              <IdentityRow
                label="Preferred sessions"
                value={sessions.length > 0 ? sessions.map(sessionLabel).join(" / ") : "Not provided"}
              />
              <IdentityRow label="Backtested trades" value={String(p?.backtested_trades ?? 0)} />
              <IdentityRow label="Real trades (approx.)" value={String(p?.real_trades_count ?? 0)} />
              <IdentityRow
                label="Risk profile"
                value={
                  rules === null
                    ? "No risk rules yet"
                    : rules.max_risk_per_trade_pct !== null
                      ? `Active — up to ${rules.max_risk_per_trade_pct}% risk per trade`
                      : "Active"
                }
              />
              <IdentityRow label="Identity verification" value={verificationLabel} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Identity verification is reviewed by an admin from submitted proof — it is separate
              from the profile-completeness badge at the top of this page.
            </p>
          </section>

          {/* Achievements — earned only on this page; the
              full set, locked included, lives on
              /achievements (see the View all link). */}
          <section className="motion-reveal" aria-label="Achievements">
            <div className="flex items-center justify-between gap-4">
              <h2 className="itg2-section-title">Achievements</h2>
              <Link href="/achievements" className="itg2-link">
                View all
              </Link>
            </div>
            {bundle === null ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Achievements will appear once Supabase is connected. Nothing here is invented.
              </p>
            ) : earned.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No achievements yet — journal trades, follow your risk rules and complete goals to earn your first one.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {earned.map((a) => {
                  const unlocked = unlockedAt.get(a.id);
                  return (
                    <article key={a.id} className="itg2-card p-4 text-center">
                      <span aria-hidden="true" className="itg2-achievement-icon mx-auto">
                        <Trophy className="h-5 w-5" />
                      </span>
                      <p className="mt-2 text-sm font-semibold leading-tight">{a.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {unlocked ? new Date(unlocked).toLocaleDateString() : "Earned"}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
            {bundle !== null && (
              <p className="mt-3 text-xs text-muted-foreground">
                {earned.length} of {bundle.achievements.length} unlocked · {xpTotal} XP total
              </p>
            )}
          </section>

        </div>

        <aside className="space-y-6">
          {/* Profile completion. */}
          <section id="profile-completion" className="motion-reveal itg2-card scroll-mt-24 p-5" aria-label="Profile completion">
            <h2 className="itg2-section-title">Profile completion</h2>
            <div
              className="relative mx-auto mt-4 h-[120px] w-[120px]"
              role="progressbar"
              aria-valuenow={completion.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Profile completion"
            >
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true" focusable="false">
                <defs>
                  <linearGradient id="itg2-completion-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#1268D8" />
                    <stop offset="55%" stopColor="#2E7CF6" />
                    <stop offset="100%" stopColor="#00CFFF" />
                  </linearGradient>
                </defs>
                <circle
                  cx="60"
                  cy="60"
                  r={COMPLETION_RING_RADIUS}
                  fill="none"
                  stroke="rgba(120, 175, 255, 0.14)"
                  strokeWidth="10"
                />
                <circle
                  cx="60"
                  cy="60"
                  r={COMPLETION_RING_RADIUS}
                  fill="none"
                  stroke="url(#itg2-completion-ring-gradient)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={COMPLETION_RING_CIRCUMFERENCE}
                  strokeDashoffset={
                    COMPLETION_RING_CIRCUMFERENCE * (1 - completion.percent / 100)
                  }
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <span className="itg2-figure">{completion.percent}%</span>
              </div>
            </div>
            {completion.missing.length === 0 ? (
              <p className="mt-4 flex items-start gap-2 text-sm itg2-text-profit">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Your profile is complete — the ITG Verified Profile badge is active.
              </p>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  {completion.nextStep} to reach 100%.
                </p>
                <ul className="mt-3 space-y-2">
                  {completion.items.map((item) => (
                    <li key={item.key} className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          item.complete
                            ? "itg2-chip-profit"
                            : "border-border bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        {item.complete ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className={item.complete ? "text-muted-foreground" : ""}>{item.label}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Certificates. */}
          <section className="motion-reveal itg2-card p-5" aria-label="Certificates">
            <h2 className="itg2-section-title">Certificates</h2>
            {certificates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No certificates yet. Monthly certificates are earned by meeting the journaling, risk, routine and review criteria.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {certificates.map((c) => (
                  <li key={c.certificate_id} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.certificate_id}</span>
                    <span className="text-muted-foreground">
                      {c.kind === "level" ? (c.level_name ?? "Level certificate") : c.month}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/certificates" className="itg2-link mt-1">
              View certificates
            </Link>
          </section>

          {/* How levels work — the honest explainer. */}
          <section className="motion-reveal itg2-card p-5" aria-label="How your level works">
            <h2 className="itg2-section-title">How your level works</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your {levelName ?? "level"} is a multi-dimensional score out of 100 — discipline,
              risk, journaling, goals, psychology, strategy, consistency and performance.
              Performance is only 5% of the score: a trader who wins every trade but journals
              nothing stays at the lowest level.
            </p>
            {bundle !== null && bundle.score.dimensions.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm">
                {bundle.score.dimensions
                  .filter((d) => d.value !== null)
                  .slice(0, 4)
                  .map((d) => (
                    <li key={d.key} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="tnum font-medium">{Math.round(d.value as number)} / 100</span>
                    </li>
                  ))}
              </ul>
            )}
            <Link href="/levels" className="itg2-link mt-1">
              Full level breakdown
            </Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
