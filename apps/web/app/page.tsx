import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpenText, LayoutDashboard, Sparkles } from "lucide-react";
import { AmbientBackground } from "@/components/ambient-background";
import { getCurrentUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

/**
 * Home page (Phase 2). Signed-in traders go straight to the
 * dashboard; everyone else sees the honest empty-state landing
 * with log in / create account. No demo trades, no fake P&L.
 *
 * Depth (Phase 18): the landing now sits on the shared
 * `.app-ambient` layer, the header is a hero card, the
 * wordmark carries the shared blue gradient, and the three
 * feature cards each carry a small gradient icon tile
 * (blue, cyan, violet for AI). No glow modifier on the
 * three cards: the token guidance is one glowing card per
 * view, and the hero header already carries the primary
 * glow. All copy stays honest — the stale Phase 2 footer
 * claiming Supabase and Vercel were "not connected yet" is
 * replaced with a timeless statement of what the system is.
 * The "not connected" alert itself lives in the auth card
 * and only appears when Supabase is unconfigured; that
 * logic is unchanged.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 overflow-hidden px-6 py-16">
      {/* Shared ambient layer (Phase 18): soft orbs + faint grid
          under the whole page. */}
      <AmbientBackground />

      <header className="hero-card motion-reveal relative p-6 sm:p-8">
        <p className="eyebrow text-muted-foreground">
          ITG — Institutional Trading Group
        </p>
        <h1 className="page-title mt-2">ITG <span className="text-gradient-blue">TraderOS</span></h1>
        <p className="page-lede mt-3 text-lg">
          A professional trading operating system: journal, performance,
          risk, psychology, goals and coaching — built around one rule:
          the database works for the trader, not the other way round.
        </p>
      </header>

      <div className="motion-reveal motion-reveal-1 relative flex flex-wrap gap-3">
        <Button asChild size="lg" className="shadow-elevation-1">
          <Link href="/login">Log in</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/register">Create an account</Link>
        </Button>
      </div>

      <section aria-label="What is ready" className="relative grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Journal",
            body: "Phase 3 — 30–60 second trade entry.",
            tile: "bg-gradient-to-br from-blue-500 to-indigo-600",
            icon: BookOpenText,
          },
          {
            title: "Dashboard",
            body: "Phase 4 — shows only your real data.",
            tile: "bg-gradient-to-br from-cyan-500 to-blue-600",
            icon: LayoutDashboard,
          },
          {
            title: "AI Coach",
            body: "Phase 9 — insights from your real data only.",
            tile: "bg-gradient-to-br from-violet-500 to-indigo-600",
            icon: Sparkles,
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <article
              key={card.title}
              className="motion-reveal card-surface p-4"
              style={{ animationDelay: `${(i + 2) * 60}ms` }}
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.tile} text-white shadow-elevation-1`} aria-hidden="true">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-semibold">{card.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>
            </article>
          );
        })}
      </section>

      <footer className="motion-reveal motion-reveal-3 relative text-sm text-muted-foreground">
        Journal, analytics, risk, psychology, goals and coaching — your
        real data only, no demo figures. Your data stays yours, and no
        real trades are executed by this system.
      </footer>
    </main>
  );
}
