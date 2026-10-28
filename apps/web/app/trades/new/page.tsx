import { redirect } from "next/navigation";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { QuickTradeForm } from "@/components/trades/quick-trade-form";
import { createTradeAction } from "@/lib/trades/actions";
import { getSystemStrategies } from "@/lib/trades/queries";

export const metadata = { title: "Add trade — ITG TraderOS" };

/**
 * Quick Entry (Phase 3, spec §9, §16; Phase 15 redesign;
 * Phase 19 premium glass redesign).
 * Minimal fields only — a trade should take 30–60 seconds.
 * Strategy is chosen here (Phase 15); psychology, lesson and
 * screenshots stay optional and live on the trade page after
 * saving. Leverage, fees and times are behind an optional
 * disclosure inside the form, not removed.
 *
 * Phase 19 presentation (docs/phase-19.md): gradient display
 * title, the "Discipline Builds Profit" motto chip from the
 * reference image (product copy, not data), and the form in
 * the `.itg-trade-form` mirror-glass panel. The glass header
 * (hamburger, ITG TraderOS logo, + Trade, notifications) and
 * the floating glass dock come from the app shell — no second
 * header or navigation is created here. Candlesticks are
 * omitted: ITG has no market-data feed and this page loads no
 * trade history, so there is no real data to render them from.
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
        <div className="motion-reveal flex items-start justify-between gap-4">
          <div>
            <h1 className="itg-add-trade-title">Add Trade</h1>
            <p className="itg-add-trade-subtitle">
              Quick entry — just the trade. Psychology, lesson and screenshots can be added afterwards.
            </p>
          </div>
          <span className="itg-discipline-chip mt-2 hidden shrink-0 sm:inline-flex">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            Discipline Builds Profit
          </span>
        </div>
        <section className="itg-trade-form motion-reveal motion-reveal-1" aria-label="Quick trade entry">
          <QuickTradeForm action={createTradeAction} submitLabel="Save Trade" strategies={strategies} />
        </section>
        <p className="mt-4 text-sm">
          <Link href="/trades" className="action-link text-muted-foreground">
            Back to trades
          </Link>
        </p>
    </AppShell>
  );
}
