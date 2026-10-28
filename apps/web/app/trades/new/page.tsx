import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { QuickTradeForm } from "@/components/trades/quick-trade-form";
import { createTradeAction } from "@/lib/trades/actions";
import { getSystemStrategies } from "@/lib/trades/queries";

export const metadata = { title: "Add trade — ITG TraderOS" };

/**
 * Quick Entry (Phase 3, spec §9, §16; Phase 15 redesign).
 * Minimal fields only — a trade should take 30–60 seconds.
 * Strategy is chosen here (Phase 15); psychology, lesson and
 * screenshots stay optional and live on the trade page after
 * saving. Leverage, fees and times are behind an optional
 * disclosure inside the form, not removed.
 */
export default async function NewTradePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const strategies = isSupabaseConfigured()
    ? await getSystemStrategies(await createServerSupabaseClient())
    : [];

  return (
    <AppShell email={user.email} narrow>
        <h1 className="page-title">Add trade</h1>
        <p className="page-lede">
          Quick entry — just the trade. Psychology, lesson and screenshots can be added afterwards.
        </p>
        <section className="card-surface mt-6 p-4 sm:p-6" aria-label="Quick trade entry">
          <QuickTradeForm action={createTradeAction} submitLabel="Save trade" strategies={strategies} />
        </section>
        <p className="mt-4 text-sm">
          <Link href="/trades" className="action-link text-muted-foreground">
            Back to trades
          </Link>
        </p>
    </AppShell>
  );
}
