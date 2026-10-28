"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveOnboardingStepAction,
  completeOnboardingAction,
  type ActionResult,
} from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { onboardingProgressPercent } from "@/lib/onboarding/completion";

const STEP_TITLES = [
  "Personal information",
  "Trading background",
  "Historical performance",
  "Current work",
  "Trading capital",
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function YesNoSelect({ name, defaultValue }: { name: string; defaultValue?: boolean | null }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue === true ? "true" : defaultValue === false ? "false" : ""}
      className="input-select"
      required
    >
      <option value="" disabled>
        Choose…
      </option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

/**
 * Onboarding wizard (Phase 2, spec §7). Five short steps, one
 * question group at a time. Anything the trader does not have can
 * be left as "Not provided" — the wizard never forces fake data,
 * and each step saves independently so progress is never lost.
 */
export function OnboardingWizard({
  initialStep,
  initialAnswers,
}: {
  initialStep: number;
  initialAnswers: Record<string, unknown>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), 5));
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    saveOnboardingStepAction,
    { ok: false },
  );
  const [done, setDone] = useState(false);
  const configured = isSupabaseConfigured();
  const a = initialAnswers as Record<string, string | number | boolean | null | undefined>;

  useEffect(() => {
    if (state.ok) {
      if (step < 5) setStep((s) => s + 1);
      else setDone(true);
      router.refresh();
    }
  }, [state, step, router]);

  const progress = onboardingProgressPercent({
    fullName: (a.fullName as string) ?? null,
    backtestingExperience: a.backtestingExperience as boolean | null,
    realTradingExperience: a.realTradingExperience as boolean | null,
    demoTrading: a.demoTrading as boolean | null,
    verificationStatus: (a.verificationStatus as string) ?? null,
    employmentStatus: (a.employmentStatus as string) ?? null,
    tradesRealMoney: a.tradesRealMoney as boolean | null,
  });

  if (done) {
    return (
      <section className="hero-card card-surface-raised card-glow-emerald p-4 sm:p-6 text-center">
        <h2 className="section-title">Onboarding complete</h2>
        <p className="mt-2 text-muted-foreground">
          Your profile is set up. Anything marked “Not Provided” can be added later from your profile — nothing was invented.
        </p>
        <form
          action={async () => {
            await completeOnboardingAction();
            router.push("/dashboard");
          }}
          className="mt-6"
        >
          <Button type="submit" disabled={!configured}>
            Go to your dashboard
          </Button>
        </form>
      </section>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Step {step} of 5 — {STEP_TITLES[step - 1]}
        </span>
        <span>{progress}% complete</span>
      </div>
      <div className="card-surface-inset mb-6 h-2 overflow-hidden rounded-full" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      {state.error && (
        <p role="alert" className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      )}
      {!configured && (
        <p role="alert" className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Supabase is not connected yet, so onboarding cannot be saved. Connect Supabase first — this form will not pretend to save.
        </p>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="step" value={step} />
        {step === 1 && (
          <>
            <Field label="Full name">
              <Input name="fullName" defaultValue={(a.fullName as string) ?? ""} required placeholder="Your full name" />
            </Field>
            <Field label="Father's name" hint="Optional — leave blank if you prefer not to share it.">
              <Input name="fatherName" defaultValue={(a.fatherName as string) ?? ""} placeholder="Not provided" />
            </Field>
            <Field label="Date of birth">
              <Input name="dateOfBirth" type="date" defaultValue={(a.dateOfBirth as string) ?? ""} />
            </Field>
            <Field label="Country">
              <Input name="country" defaultValue={(a.country as string) ?? ""} placeholder="Not provided" />
            </Field>
          </>
        )}
        {step === 2 && (
          <>
            <Field label="Trading experience" hint="Optional — e.g. Beginner, 2 years, Professional.">
              <Input name="tradingExperience" defaultValue={(a.tradingExperience as string) ?? ""} placeholder="Not provided" />
            </Field>
            <Field label="Trading education">
              <Input name="tradingEducation" defaultValue={(a.tradingEducation as string) ?? ""} placeholder="Not provided" />
            </Field>
            <Field label="Have you done backtesting?">
              <YesNoSelect name="backtestingExperience" defaultValue={a.backtestingExperience as boolean | null} />
            </Field>
            <Field label="Number of backtested trades">
              <Input name="backtestedTrades" type="number" min={0} defaultValue={a.backtestedTrades != null ? String(a.backtestedTrades) : ""} placeholder="0" />
            </Field>
            <Field label="Have you traded with real money?">
              <YesNoSelect name="realTradingExperience" defaultValue={a.realTradingExperience as boolean | null} />
            </Field>
            <Field label="Approximate number of real trades">
              <Input name="realTradesCount" type="number" min={0} defaultValue={a.realTradesCount != null ? String(a.realTradesCount) : ""} placeholder="0" />
            </Field>
            <Field label="Have you used demo / paper trading?">
              <YesNoSelect name="demoTrading" defaultValue={a.demoTrading as boolean | null} />
            </Field>
          </>
        )}
        {step === 3 && (
          <>
            <Field label="Historical profit" hint="Optional. Leave blank if not available — it will show as Not Provided, never as zero.">
              <Input name="historicalProfit" type="number" min={0} step="0.01" defaultValue={a.historicalProfit != null ? String(a.historicalProfit) : ""} placeholder="Not provided" />
            </Field>
            <Field label="Historical loss">
              <Input name="historicalLoss" type="number" min={0} step="0.01" defaultValue={a.historicalLoss != null ? String(a.historicalLoss) : ""} placeholder="Not provided" />
            </Field>
            <Field
              label="Exchange payout / statement verification (self-declared)"
              hint="This records your claim only — an admin reviews verification, and your profile shows Not Provided until then."
            >
              <select
                name="verificationStatus"
                defaultValue={(a.verificationStatus as string) ?? "not_provided"}
                className="input-select"
              >
                <option value="not_provided">Not provided</option>
                <option value="partial">Partially verified</option>
                <option value="verified">Verified</option>
              </select>
            </Field>
          </>
        )}
        {step === 4 && (
          <>
            <Field label="What is your current work situation?">
              <select
                name="employmentStatus"
                defaultValue={(a.employmentStatus as string) ?? "not_provided"}
                className="input-select"
              >
                <option value="full_time">I trade full-time</option>
                <option value="part_time">I trade part-time</option>
                <option value="employed_other_job">I have another job</option>
                <option value="unemployed">Currently unemployed</option>
                <option value="studying">Studying</option>
                <option value="not_provided">Not provided</option>
              </select>
            </Field>
            <Field label="Monthly income (if you have another job)" hint="Private — only you can see this. Leave blank if not applicable.">
              <Input name="monthlyIncome" type="number" min={0} step="0.01" defaultValue={a.monthlyIncome != null ? String(a.monthlyIncome) : ""} placeholder="Not provided" />
            </Field>
          </>
        )}
        {step === 5 && (
          <>
            <Field label="Current trading investment" hint="Optional and private. Leave blank if not applicable.">
              <Input name="tradingCapital" type="number" min={0} step="0.01" defaultValue={a.tradingCapital != null ? String(a.tradingCapital) : ""} placeholder="Not provided" />
            </Field>
            <Field label="Do you currently trade real money?">
              <YesNoSelect name="tradesRealMoney" defaultValue={a.tradesRealMoney as boolean | null} />
            </Field>
            <Field label="Do you use demo / paper trading?">
              <YesNoSelect name="demoTrading" defaultValue={a.demoTrading as boolean | null} />
            </Field>
          </>
        )}
        <div className="flex gap-3 pt-2">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={pending || !configured}>
            {pending ? "Saving…" : step === 5 ? "Finish onboarding" : "Save and continue"}
          </Button>
        </div>
      </form>
    </div>
  );
}
