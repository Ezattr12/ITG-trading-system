import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateProfileAction, uploadAvatarAction } from "@/lib/auth/actions";
import { displayOrNotProvided } from "@/lib/onboarding/completion";

export const metadata = { title: "Profile — ITG TraderOS" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Trader profile (Phase 2, spec §29). Edit personal + trading
 * information, change the photo, and view level / achievements /
 * certificates — all as honest empty states until Phases 7–8.
 * Sensitive financial fields are shown only to the owner here.
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = user.profile;
  const configured = isSupabaseConfigured();

  let achievements: { name: string }[] = [];
  let certificates: { certificate_id: string; month: string }[] = [];
  let levelName: string | null = null;
  if (configured && p) {
    const supabase = await createServerSupabaseClient();
    const { data: ua } = await supabase
      .from("user_achievements")
      .select("achievements(name)")
      .eq("user_id", user.id);
    achievements = (ua ?? []).map((r) => ({
      name: (r.achievements as { name?: string } | null)?.name ?? "Achievement",
    }));
    const { data: certs } = await supabase
      .from("certificates")
      .select("certificate_id, month")
      .eq("user_id", user.id)
      .order("month", { ascending: false });
    certificates = (certs ?? []) as { certificate_id: string; month: string }[];
    const { data: level } = await supabase
      .from("user_levels")
      .select("levels(name)")
      .eq("user_id", user.id)
      .maybeSingle();
    const levels = level?.levels as { name?: string } | null;
    levelName = levels?.name ?? null;
  }

  return (
    <AppShell email={user.email} narrow>
        <h1 className="page-title">Your profile</h1>
        <p className="page-lede">
          {displayOrNotProvided(p?.full_name)} · {displayOrNotProvided(p?.verification_status === "verified" ? "Verified" : p?.verification_status === "partial" ? "Partially Verified" : "Not Provided")}
        </p>
        {!configured && (
          <p role="alert" className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {supabaseNotConnectedMessage()}
          </p>
        )}

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Profile photo">
          <h2 className="section-title">Profile photo</h2>
          {p?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar_url} alt="Your profile photo" className="mt-4 h-24 w-24 rounded-full object-cover" />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No photo yet.</p>
          )}
          <ActionForm action={uploadAvatarAction} submitLabel="Upload photo">
            <Input name="avatar" type="file" accept="image/*" />
            <p className="text-xs text-muted-foreground">
              Images only, 2 MB or smaller. {configured ? "Stored in Supabase Storage." : "Upload is disabled until Supabase is connected — no fake photo will be shown."}
            </p>
          </ActionForm>
        </section>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Edit profile">
          <h2 className="section-title">Edit profile</h2>
          <ActionForm action={updateProfileAction} submitLabel="Save profile">
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field label="Trading capital (private)">
                <Input name="tradingCapital" type="number" min={0} step="0.01" defaultValue={p?.trading_capital ?? ""} placeholder="Not provided" />
              </Field>
              <Field label="Monthly income (private, if you have another job)">
                <Input name="monthlyIncome" type="number" min={0} step="0.01" defaultValue={p?.monthly_income ?? ""} placeholder="Not provided" />
              </Field>
            </div>
            <input type="hidden" name="backtestingExperience" value={p?.backtesting_experience ? "true" : "false"} />
            <input type="hidden" name="realTradingExperience" value={p?.real_trading_experience ? "true" : "false"} />
            <input type="hidden" name="demoTrading" value={p?.demo_trading ? "true" : "false"} />
            <input type="hidden" name="tradesRealMoney" value={p?.trades_real_money ? "true" : "false"} />
            <input type="hidden" name="employmentStatus" value={p?.employment_status ?? "not_provided"} />
            <p className="text-xs text-muted-foreground">
              Experience checkboxes are edited in onboarding; the values above are carried over unchanged here. Full profile editing, including those fields, arrives with the profile editor in Phase 4.
            </p>
          </ActionForm>
        </section>

        <section className="mt-6 sm:mt-8 grid gap-4 sm:grid-cols-3" aria-label="Progress">
          <article className="card-surface p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Level</h2>
            <p className="mt-2 font-semibold">{displayOrNotProvided(levelName)}</p>
          </article>
          <article className="card-surface p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Achievements</h2>
            {achievements.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No achievements yet. (Phase 7)</p>
            ) : (
              <ul className="mt-2 list-disc pl-4 text-sm">{achievements.map((a) => <li key={a.name}>{a.name}</li>)}</ul>
            )}
          </article>
          <article className="card-surface p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Certificates</h2>
            {certificates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No certificates yet. (Phase 8)</p>
            ) : (
              <ul className="mt-2 list-disc pl-4 text-sm">{certificates.map((c) => <li key={c.certificate_id}>{c.certificate_id} — {c.month}</li>)}</ul>
            )}
          </article>
        </section>
    </AppShell>
  );
}
