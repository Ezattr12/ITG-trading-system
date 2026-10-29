import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, Trophy, Lock, Check } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/lib/auth/actions";
import { displayOrNotProvided } from "@/lib/onboarding/completion";
import { calcProfileCompletion } from "@/lib/profile/completion";
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
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { LevelRing } from "@/components/profile/level-ring";
import { CountUpXp } from "@/components/analytics/count-up";

export const metadata = { title: "Profile — ITG TraderOS" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * Premium trader profile (Phase 19, spec §29, Ezat's Aurora
 * Glass system — docs/phase-19-design-reference.css, adapted
 * into globals.css as the .itg-* classes).
 *
 * Identity first, settings second: a hero glass card (photo,
 * name, completeness badge, level ring, XP + level progress),
 * then key stats, Trading Identity, achievements, and the edit
 * form as a secondary section. Everything shown comes from
 * real stored data:
 * - Level: the existing multi-dimensional score
 *   (Bronze/Silver/Gold/Platinum, spec §8) — the level of
 *   record. There is no XP-based "Level 7" ladder in this
 *   product; XP is displayed as accumulated XP, and the bar
 *   shows progress through the current level's score band.
 * - "ITG Verified Profile": a profile-completeness badge,
 *   computed from the stored profile row (100% of the 8
 *   required items). It is NOT identity/KYC verification —
 *   the admin-reviewed verification_status is shown
 *   separately in Trading Identity.
 * - Achievements: only earned ones are marked earned;
 *   the rest are shown locked. Statistics: real trade
 *   calculations. Empty states stay honest ("Not Provided").
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = user.profile;
  const configured = isSupabaseConfigured();

  const completion = calcProfileCompletion({
    fullName: p?.full_name,
    fatherName: p?.father_name,
    dateOfBirth: p?.date_of_birth,
    country: p?.country,
    avatarUrl: p?.avatar_url,
    tradingExperience: p?.trading_experience,
    tradingEducation: p?.trading_education,
    employmentStatus: p?.employment_status,
  });

  let bundle: Awaited<ReturnType<typeof getGamificationBundle>> | null = null;
  let plan: Awaited<ReturnType<typeof getTradingPlan>> = null;
  let rules: Awaited<ReturnType<typeof getRiskRules>> = null;
  let certificates: { certificate_id: string; month: string }[] = [];
  if (configured && p) {
    const supabase = await createServerSupabaseClient();
    const [b, pl, r, { data: certs }] = await Promise.all([
      getGamificationBundle(supabase, user.id),
      getTradingPlan(supabase, user.id),
      getRiskRules(supabase, user.id),
      supabase
        .from("certificates")
        .select("certificate_id, month")
        .eq("user_id", user.id)
        .order("month", { ascending: false }),
    ]);
    bundle = b;
    plan = pl;
    rules = r;
    certificates = (certs ?? []) as { certificate_id: string; month: string }[];
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
  const locked = (bundle?.achievements ?? []).filter((a) => !unlockedIds.has(a.id));
  const achievementsShown = [...earned, ...locked].slice(0, 6);

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
      <p className="eyebrow">Trader profile</p>
      {!configured && (
        <p role="alert" className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {supabaseNotConnectedMessage()}
        </p>
      )}

      {/* Hero glass profile card — Ezat's .itg-* system. */}
      <section className="itg-glass itg-glass-hero itg-profile-hero motion-reveal mt-4 sm:mt-6" aria-label="Trader profile">
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:gap-8 sm:text-left">
          <AvatarUpload
            avatarUrl={p?.avatar_url ?? null}
            name={p?.full_name ?? user.email ?? "Trader"}
            configured={configured}
          />
          <div className="min-w-0 flex-1">
            <h1 className="page-title">{displayOrNotProvided(p?.full_name)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {p?.role === "admin" ? "Admin" : "Professional Trader"}
              {p?.country ? ` · ${p.country}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {completion.verified ? (
                <span className="itg-verified text-sm">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  ITG Verified Profile
                </span>
              ) : (
                <Link
                  href="#profile-completion"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3.5 py-2 text-sm font-medium transition-colors hover:border-white/25 hover:text-foreground"
                >
                  Profile {completion.percent}% complete
                  <span className="text-muted-foreground">· {completion.nextStep}</span>
                </Link>
              )}
            </div>
            <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground sm:mx-0">
              {completion.verified
                ? "Profile complete — this badge confirms your profile information is complete. It is not identity (KYC) verification."
                : "The ITG Verified Profile badge activates when your profile information is complete. It is a completeness badge, not identity verification."}
            </p>
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
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="itg-xp text-xl font-bold">
              <CountUpXp value={xpTotal} />
              <span className="ml-2 text-sm font-medium text-muted-foreground">
                {bundle === null ? "— connect Supabase to load XP" : "total XP earned"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {progress === null
                ? "Journal trades to earn a level"
                : progress.nextLevel === null
                  ? "Top level reached"
                  : `${progress.pointsToNext} points to ${progress.nextLevel}`}
            </p>
          </div>
          <div
            className="itg-xp-bar mt-2"
            role="progressbar"
            aria-valuenow={Math.round(progress?.progressPct ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress to the next level"
          >
            <div className="itg-xp-progress" style={{ width: `${progress?.progressPct ?? 0}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Your level is scored on discipline, risk, journaling, goals, psychology, strategy,
            consistency and performance — not profit alone.{" "}
            <Link href="/levels" className="font-medium text-foreground underline">
              How levels work
            </Link>
          </p>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Key stats — real trade calculations only. */}
          <section className="motion-reveal" aria-label="Key statistics">
            <h2 className="section-title">Key stats</h2>
            {summary === null ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Statistics will appear once Supabase is connected and you have trades. Nothing here is estimated.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <article className="itg-stat">
                  <p className="text-xs font-medium text-muted-foreground">Total trades</p>
                  <p className="itg-stat-value mt-1">{summary.tradeCount}</p>
                </article>
                <article className="itg-stat">
                  <p className="text-xs font-medium text-muted-foreground">Win rate</p>
                  <p className={`itg-stat-value mt-1 ${summary.winRate !== null && summary.winRate >= 50 ? "text-emerald-300" : ""}`}>
                    {summary.winRate === null ? "—" : `${Math.round(summary.winRate)}%`}
                  </p>
                </article>
                <article className="itg-stat">
                  <p className="text-xs font-medium text-muted-foreground">Profit factor</p>
                  <p className="itg-stat-value mt-1">
                    {summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}
                  </p>
                </article>
                <article className="itg-stat">
                  <p className="text-xs font-medium text-muted-foreground">Average R</p>
                  <p className="itg-stat-value mt-1">
                    {summary.avgR === null ? "—" : summary.avgR.toFixed(2)}
                  </p>
                </article>
                <article className="itg-stat">
                  <p className="text-xs font-medium text-muted-foreground">Best strategy</p>
                  <p className="mt-1 truncate text-lg font-bold leading-tight">
                    {best === null ? "Not provided" : best.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {best === null
                      ? "Needs 3+ trades on one strategy"
                      : `Win rate ${Math.round(best.winRate)}% · ${best.trades} trades`}
                  </p>
                </article>
                <article className="itg-stat">
                  <p className="text-xs font-medium text-muted-foreground">Current streak</p>
                  <p className="mt-1 text-lg font-bold leading-tight">{streakLabel}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {summary.tradeCount === 0 ? "Journal your first trade" : `${summary.wins} wins · ${summary.losses} losses`}
                  </p>
                </article>
              </div>
            )}
          </section>

          {/* Trading Identity — only fields that actually exist. */}
          <section className="motion-reveal card-surface p-4 sm:p-6" aria-label="Trading identity">
            <div className="flex items-center justify-between gap-4">
              <h2 className="section-title">Trading Identity</h2>
              <Link href="#edit-profile" className="text-sm font-medium underline">
                Edit
              </Link>
            </div>
            <dl className="mt-2 divide-y divide-border">
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
                label="Risk plan"
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

          {/* Achievements — earned only; the rest shown locked. */}
          <section className="motion-reveal" aria-label="Achievements">
            <div className="flex items-center justify-between gap-4">
              <h2 className="section-title">Achievements</h2>
              <Link href="/achievements" className="text-sm font-medium underline">
                View all
              </Link>
            </div>
            {bundle === null ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Achievements will appear once Supabase is connected. Nothing here is invented.
              </p>
            ) : achievementsShown.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No achievements yet — journal trades, follow your risk rules and complete goals to earn your first one.
              </p>
            ) : (
              <div className="itg-achievements mt-3">
                {achievementsShown.map((a) => {
                  const isEarned = unlockedIds.has(a.id);
                  const unlocked = unlockedAt.get(a.id);
                  return (
                    <article
                      key={a.id}
                      className={`itg-achievement ${isEarned ? "" : "opacity-60"}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border ${
                          isEarned
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            : "border-border bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        {isEarned ? <Trophy className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                      </span>
                      <p className="mt-2 text-sm font-semibold leading-tight">{a.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {isEarned && unlocked
                          ? new Date(unlocked).toLocaleDateString()
                          : isEarned
                            ? "Earned"
                            : "Locked"}
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

          {/* Edit profile — secondary section, below the identity. */}
          <section id="edit-profile" className="motion-reveal card-surface scroll-mt-24 p-4 sm:p-6" aria-label="Edit profile">
            <h2 className="section-title">Edit profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your identity above updates automatically when you save changes here.
            </p>
            <ActionForm action={updateProfileAction} submitLabel="Save profile">
              <details open className="group mt-4">
                <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    Personal Information
                    <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Full name">
                    <Input name="fullName" defaultValue={p?.full_name ?? ""} required />
                  </Field>
                  <Field label="Father's name">
                    <Input name="fatherName" defaultValue={p?.father_name ?? ""} placeholder="Not provided" />
                  </Field>
                  <Field label="Date of birth">
                    <Input name="dateOfBirth" type="date" defaultValue={p?.date_of_birth ?? ""} />
                  </Field>
                  <Field label="Country">
                    <Input name="country" defaultValue={p?.country ?? ""} placeholder="Not provided" />
                  </Field>
                </div>
              </details>
              <details className="group mt-6">
                <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    Trading Background
                    <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Trading experience">
                    <Input name="tradingExperience" defaultValue={p?.trading_experience ?? ""} placeholder="Not provided" />
                  </Field>
                  <Field label="Trading education">
                    <Input name="tradingEducation" defaultValue={p?.trading_education ?? ""} placeholder="Not provided" />
                  </Field>
                  <Field label="Backtested trades">
                    <Input name="backtestedTrades" type="number" min={0} defaultValue={p?.backtested_trades ?? 0} />
                  </Field>
                  <Field label="Real trades (approx.)">
                    <Input name="realTradesCount" type="number" min={0} defaultValue={p?.real_trades_count ?? 0} />
                  </Field>
                </div>
              </details>
              <details className="group mt-6">
                <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    Private Financial
                    <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Trading capital (private)">
                    <Input name="tradingCapital" type="number" min={0} step="0.01" defaultValue={p?.trading_capital ?? ""} placeholder="Not provided" />
                  </Field>
                  <Field label="Monthly income (private, if you have another job)">
                    <Input name="monthlyIncome" type="number" min={0} step="0.01" defaultValue={p?.monthly_income ?? ""} placeholder="Not provided" />
                  </Field>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Private — only you can see these values.
                </p>
              </details>
              <input type="hidden" name="backtestingExperience" value={p?.backtesting_experience ? "true" : "false"} />
              <input type="hidden" name="realTradingExperience" value={p?.real_trading_experience ? "true" : "false"} />
              <input type="hidden" name="demoTrading" value={p?.demo_trading ? "true" : "false"} />
              <input type="hidden" name="tradesRealMoney" value={p?.trades_real_money ? "true" : "false"} />
              <input type="hidden" name="employmentStatus" value={p?.employment_status ?? "not_provided"} />
              <p className="text-xs text-muted-foreground">
                Experience checkboxes and work status are edited in onboarding; the values above are carried over unchanged here.
              </p>
            </ActionForm>
          </section>
        </div>

        <aside className="space-y-6">
          {/* Profile completion. */}
          <section id="profile-completion" className="motion-reveal card-surface scroll-mt-24 p-4 sm:p-5" aria-label="Profile completion">
            <h2 className="section-title">Profile completion</h2>
            <p className="metric-hero mt-2">
              <span className="text-gradient-blue">{completion.percent}%</span>
            </p>
            <div
              className="itg-xp-bar mt-3"
              role="progressbar"
              aria-valuenow={completion.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Profile completion"
            >
              <div className="itg-xp-progress" style={{ width: `${completion.percent}%` }} />
            </div>
            {completion.missing.length === 0 ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-emerald-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Your profile is complete — the ITG Verified Profile badge is active.
              </p>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  {completion.nextStep} to reach 100%.
                </p>
                <ul className="mt-3 space-y-2">
                  {completion.items.map((item) => (
                    <li key={item.key} className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          item.complete
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
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
          <section className="motion-reveal card-surface p-4 sm:p-5" aria-label="Certificates">
            <h2 className="section-title">Certificates</h2>
            {certificates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No certificates yet. Monthly certificates are earned by meeting the journaling, risk, routine and review criteria.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {certificates.map((c) => (
                  <li key={c.certificate_id} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.certificate_id}</span>
                    <span className="text-muted-foreground">{c.month}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/certificates" className="mt-3 inline-block text-sm font-medium underline">
              View certificates
            </Link>
          </section>

          {/* How levels work — the honest explainer. */}
          <section className="motion-reveal card-surface card-glow-violet p-4 sm:p-5" aria-label="How your level works">
            <h2 className="section-title">How your level works</h2>
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
            <Link href="/levels" className="mt-3 inline-block text-sm font-medium underline">
              Full level breakdown
            </Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
