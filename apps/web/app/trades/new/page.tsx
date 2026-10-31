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
 * Phase 19 premium glass redesign; Master Web UI Redesign
 * Page 2 — v2 glass terminal).
 * Minimal fields only — a trade should take 30–60 seconds.
 * Strategy is chosen here (Phase 15); psychology and lesson
 * stay optional and live on the trade page after saving.
 * A screenshot can now be attached right here at create
 * time (Page 2, as on mobile) or added later from the trade
 * page. Leverage, fees and times are behind an optional
 * disclosure inside the form, not removed.
 *
 * Page 2 presentation: an `.itg2` header band (eyebrow,
 * `.itg2-page-title`, the "Discipline Builds Profit" motto
 * chip from the reference image — product copy, not data)
 * and the form's own glass panels (see QuickTradeForm). The
 * glass header (hamburger, ITG TraderOS logo, + Trade,
 * notifications) and the floating glass dock come from the
 * app shell — no second header or navigation is created
 * here. Candlesticks are omitted: ITG has no market-data
 * feed and this page loads no trade history, so there is
 * no real data to render them from.
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
        <div className="itg2-card itg2-card-flat motion-reveal flex items-start justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="itg2-eyebrow">Quick entry</p>
            <h1 className="itg2-page-title mt-1">Add Trade</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Quick entry — just the trade. Attach a screenshot now if you have one; psychology and lesson
              can be added afterwards.
            </p>
          </div>
          <span className="itg2-chip itg2-chip-gold mt-1 hidden shrink-0 sm:inline-flex">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            Discipline Builds Profit
          </span>
        </div>
        <section className="motion-reveal motion-reveal-1 mt-4" aria-label="Quick trade entry">
          <QuickTradeForm action={createTradeAction} submitLabel="Save Trade" strategies={strategies} attachScreenshot />
        </section>
        <p className="mt-4 text-sm">
          <Link href="/trades" className="itg2-link">
            Back to trades
          </Link>
        </p>
    </AppShell>
  );
}
