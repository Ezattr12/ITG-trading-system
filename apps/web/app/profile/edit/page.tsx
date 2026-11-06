import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/lib/auth/actions";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { DeleteOwnAccountForm } from "@/components/account/account-forms";

export const metadata = { title: "Edit profile — ITG TraderOS" };

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="itg2-field space-y-2">
      <Label htmlFor={htmlFor} className="itg2-label">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * Edit Profile (Profile UI/UX Correction, Ezat 2026-11-05).
 *
 * The dedicated editing surface: the profile form and the
 * avatar upload control that used to sit inline on /profile
 * live here now, MOVED — same ActionForm machinery, same
 * updateProfileAction (which writes through the shared
 * updateProfileCore for the signed-in user only), same
 * AvatarUpload component on the existing upload action and
 * storage path. Nothing was rebuilt in parallel.
 *
 * On a successful save the action returns
 * `redirectTo: "/profile"` (and revalidates both routes),
 * so the trader lands back on the read-only profile with
 * the new values and photo already rendered.
 */
export default async function EditProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = user.profile;
  const configured = isSupabaseConfigured();

  return (
    <AppShell email={user.email}>
      <header className="itg2-card itg2-card-flat p-5 sm:p-6">
        <p className="itg2-eyebrow">Trader profile</p>
        <h1 className="itg2-page-title mt-1">Edit profile</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Your identity on your profile updates automatically when you save changes here.
        </p>
        <Link href="/profile" className="itg2-link mt-3">
          Back to profile
        </Link>
      </header>

      {!configured && (
        <p role="alert" className="itg2-notice itg2-notice-warning mt-4">
          {supabaseNotConnectedMessage()}
        </p>
      )}

      {/* Profile photo — the one place the picture can change. */}
      <section className="motion-reveal itg2-card mt-6 p-5 sm:p-6" aria-label="Profile photo">
        <h2 className="itg2-section-title">Profile photo</h2>
        <div className="mt-4 flex justify-center sm:justify-start">
          <AvatarUpload
            avatarUrl={p?.avatar_url ?? null}
            name={p?.full_name ?? user.email ?? "Trader"}
            configured={configured}
          />
        </div>
      </section>

      {/* Profile details — the moved form, field for field. */}
      <section className="motion-reveal itg2-card itg2-card-flat mt-6 p-5 sm:p-6" aria-label="Profile details">
        <ActionForm action={updateProfileAction} submitLabel="Save changes" submitClassName="itg2-btn-primary itg2-btn-save">
          <details open className="itg2-card itg2-card-flat mt-4 p-5 sm:p-6">
            <summary className="itg2-details-summary">
              Personal Information
              <ChevronDown className="itg2-details-chevron h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="fullName">
                <Input id="fullName" name="fullName" defaultValue={p?.full_name ?? ""} required className="itg2-input" />
              </Field>
              <Field label="Father's name" htmlFor="fatherName">
                <Input id="fatherName" name="fatherName" defaultValue={p?.father_name ?? ""} placeholder="Not provided" className="itg2-input" />
              </Field>
              <Field label="Date of birth" htmlFor="dateOfBirth">
                <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={p?.date_of_birth ?? ""} className="itg2-input" />
              </Field>
              <Field label="Country" htmlFor="country">
                <Input id="country" name="country" defaultValue={p?.country ?? ""} placeholder="Not provided" className="itg2-input" />
              </Field>
            </div>
          </details>
          <details className="itg2-card itg2-card-flat p-5 sm:p-6">
            <summary className="itg2-details-summary">
              Trading Background
              <ChevronDown className="itg2-details-chevron h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Trading experience" htmlFor="tradingExperience">
                <Input id="tradingExperience" name="tradingExperience" defaultValue={p?.trading_experience ?? ""} placeholder="Not provided" className="itg2-input" />
              </Field>
              <Field label="Trading education" htmlFor="tradingEducation">
                <Input id="tradingEducation" name="tradingEducation" defaultValue={p?.trading_education ?? ""} placeholder="Not provided" className="itg2-input" />
              </Field>
              <Field label="Backtested trades" htmlFor="backtestedTrades">
                <Input id="backtestedTrades" name="backtestedTrades" type="number" min={0} defaultValue={p?.backtested_trades ?? 0} className="itg2-input" />
              </Field>
              <Field label="Real trades (approx.)" htmlFor="realTradesCount">
                <Input id="realTradesCount" name="realTradesCount" type="number" min={0} defaultValue={p?.real_trades_count ?? 0} className="itg2-input" />
              </Field>
            </div>
          </details>
          <details open className="itg2-card itg2-card-flat p-5 sm:p-6">
            <summary className="itg2-details-summary">
              Work & Trading
              <ChevronDown className="itg2-details-chevron h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Work status" htmlFor="employmentStatus">
                <select
                  id="employmentStatus"
                  name="employmentStatus"
                  defaultValue={p?.employment_status ?? "not_provided"}
                  className="itg2-select"
                >
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="employed_other_job">Employed (other job)</option>
                  <option value="unemployed">Unemployed</option>
                  <option value="studying">Studying</option>
                  <option value="not_provided">Prefer not to say</option>
                </select>
              </Field>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A real work status is required for a complete profile — “Prefer not to say”
              leaves the profile incomplete. If you have another job, add your monthly
              income under Private Financial below.
            </p>
          </details>
          <details className="itg2-card itg2-card-flat p-5 sm:p-6">
            <summary className="itg2-details-summary">
              Private Financial
              <ChevronDown className="itg2-details-chevron h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Trading capital (private)" htmlFor="tradingCapital">
                <Input id="tradingCapital" name="tradingCapital" type="number" min={0} step="0.01" defaultValue={p?.trading_capital ?? ""} placeholder="Not provided" className="itg2-input" />
              </Field>
              <Field label="Monthly income (private, if you have another job)" htmlFor="monthlyIncome">
                <Input id="monthlyIncome" name="monthlyIncome" type="number" min={0} step="0.01" defaultValue={p?.monthly_income ?? ""} placeholder="Not provided" className="itg2-input" />
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
          <p className="text-xs text-muted-foreground">
            Experience checkboxes are edited in onboarding; the values above are carried over unchanged here.
          </p>
        </ActionForm>
      </section>

      {/* Danger zone — permanent account deletion. The form
          posts to deleteOwnAccountAction (lib/account): the
          signed-in user only, password re-verified, the
          literal DELETE typed, then the ONE deletion core
          removes the account and the action redirects to
          /login?account_deleted=1. */}
      <section className="motion-reveal itg2-card mt-6 p-5 sm:p-6" aria-label="Delete account">
        <h2 className="itg2-section-title">Delete account</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Deleting your account is permanent and cannot be undone — your profile, journal,
          trades, reviews, goals, progress, certificates, uploaded photos and screenshots are
          removed, along with your sign-in account. Security audit-log entries are retained
          with the link to your account permanently removed, and backups taken before deletion
          may contain your data until they are rotated out.
        </p>
        <div className="mt-4 max-w-md">
          <DeleteOwnAccountForm />
        </div>
      </section>
    </AppShell>
  );
}
