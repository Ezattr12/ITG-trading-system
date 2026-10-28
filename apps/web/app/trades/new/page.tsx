import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/app-header";
import { QuickTradeForm } from "@/components/trades/quick-trade-form";
import { createTradeAction } from "@/lib/trades/actions";

export const metadata = { title: "Add trade — ITG TraderOS" };

/**
 * Quick Entry (Phase 3, spec §9, §16). Minimal fields only —
 * a trade should take 30–60 seconds. Advanced review
 * (strategy, psychology, lesson, screenshot) is optional and
 * lives on the trade page after saving.
 */
export default async function NewTradePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  return (
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">Add trade</h1>
        <p className="mt-1 text-muted-foreground">
          Quick entry — just the trade. Strategy, psychology, lesson and screenshots can be added afterwards.
        </p>
        <section className="mt-6 rounded-lg border bg-card p-6" aria-label="Quick trade entry">
          <QuickTradeForm action={createTradeAction} submitLabel="Save trade" />
        </section>
        <p className="mt-4 text-sm">
          <Link href="/trades" className="text-muted-foreground underline">
            Back to trades
          </Link>
        </p>
      </main>
    </div>
  );
}
