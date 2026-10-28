import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

/**
 * Home page (Phase 2). Signed-in traders go straight to the
 * dashboard; everyone else sees the honest empty-state landing
 * with log in / create account. No demo trades, no fake P&L.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          ITG — Institutional Trading Group
        </p>
        <h1 className="mt-2 text-4xl font-bold">ITG TraderOS</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          A professional trading operating system: journal, performance,
          risk, psychology, goals and coaching — built around one rule:
          the database works for the trader, not the other way round.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/login">Log in</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/register">Create an account</Link>
        </Button>
      </div>

      <section aria-label="What is ready" className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Journal", body: "Phase 3 — 30–60 second trade entry." },
          { title: "Dashboard", body: "Phase 4 — shows only your real data." },
          { title: "AI Coach", body: "Phase 9 — insights from your real data only." },
        ].map((card) => (
          <article key={card.title} className="card-surface p-4">
            <h3 className="font-semibold">{card.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>
          </article>
        ))}
      </section>

      <footer className="text-sm text-muted-foreground">
        Phase 2 — Authentication &amp; onboarding. Supabase and Vercel are not
        connected yet; sign-in will work once Supabase is connected.
      </footer>
    </main>
  );
}
