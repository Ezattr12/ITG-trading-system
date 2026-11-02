import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { supabaseNotConnectedMessage } from "@/lib/supabase/config";

export const metadata = { title: "Onboarding — ITG TraderOS" };

/**
 * Onboarding page (Phase 2, spec §7). A standalone page (not the
 * AuthCard shell, not the AppShell): the signed-in trader who has
 * not finished onboarding is redirected here to complete the
 * five-step wizard.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * the header moved into the flat glass band (.itg2-card
 * .itg2-card-flat with .itg2-eyebrow + .itg2-page-title), the
 * saved notice became an .itg2-notice-success and the wizard
 * panel an .itg2-card .itg2-card-flat. All redirects, answer
 * merging and copy are exactly as before.
 */

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.onboarding?.is_complete) redirect("/dashboard");

  const params = await searchParams;
  const answers = (user.onboarding?.answers ?? {}) as Record<string, unknown>;
  // Merge profile columns into answers so the wizard can pre-fill.
  const merged: Record<string, unknown> = {
    fullName: user.profile?.full_name,
    fatherName: user.profile?.father_name,
    dateOfBirth: user.profile?.date_of_birth,
    country: user.profile?.country,
    tradingExperience: user.profile?.trading_experience,
    tradingEducation: user.profile?.trading_education,
    backtestingExperience: user.profile?.backtesting_experience,
    backtestedTrades: user.profile?.backtested_trades,
    realTradingExperience: user.profile?.real_trading_experience,
    realTradesCount: user.profile?.real_trades_count,
    demoTrading: user.profile?.demo_trading,
    historicalProfit: user.profile?.historical_profit,
    historicalLoss: user.profile?.historical_loss,
    verificationStatus: user.profile?.verification_status,
    employmentStatus: user.profile?.employment_status,
    monthlyIncome: user.profile?.monthly_income,
    tradingCapital: user.profile?.trading_capital,
    tradesRealMoney: user.profile?.trades_real_money,
    ...answers,
  };
  const initialStep = user.onboarding?.current_step ?? 1;

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-12">
      <header className="itg2-card itg2-card-flat p-5 sm:p-6">
        <p className="itg2-eyebrow">
          ITG — Institutional Trading Group
        </p>
        <h1 className="itg2-page-title mt-1">Set up your trader profile</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Five short steps. Anything you don&apos;t have, leave as “Not provided” — we never
          ask you to invent experience, profit or capital.
        </p>
      </header>
      {params.done && (
        <p role="status" className="itg2-notice itg2-notice-success mt-6">
          Onboarding saved. You can finish it from your dashboard at any time.
        </p>
      )}
      <section className="itg2-card itg2-card-flat mt-6 p-4 sm:mt-8 sm:p-6">
        <OnboardingWizard initialStep={initialStep} initialAnswers={merged} />
      </section>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {supabaseNotConnectedMessage()}
      </p>
    </main>
  );
}
