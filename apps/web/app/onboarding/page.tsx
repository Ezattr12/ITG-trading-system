import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { supabaseNotConnectedMessage } from "@/lib/supabase/config";

export const metadata = { title: "Onboarding — ITG TraderOS" };

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
      <header>
        <p className="eyebrow">
          ITG — Institutional Trading Group
        </p>
        <h1 className="page-title mt-2">Set up your trader profile</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Five short steps. Anything you don&apos;t have, leave as “Not provided” — we never
          ask you to invent experience, profit or capital.
        </p>
      </header>
      {params.done && (
        <p role="status" className="mt-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Onboarding saved. You can finish it from your dashboard at any time.
        </p>
      )}
      <section className="hero-card card-surface-raised card-glow-blue mt-6 p-4 sm:mt-8 sm:p-6">
        <OnboardingWizard initialStep={initialStep} initialAnswers={merged} />
      </section>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {supabaseNotConnectedMessage()}
      </p>
    </main>
  );
}
