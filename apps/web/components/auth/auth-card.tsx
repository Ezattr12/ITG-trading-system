import type { ReactNode } from "react";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";

/**
 * Shared auth shell (Phase 2, spec §37): premium dark login page,
 * lightweight — no heavy 3D, fast by design. A subtle CSS-only
 * chart-like backdrop (no images, no WebGL) keeps it fast.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const configured = isSupabaseConfigured();
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(217 32% 17% / 0.35) 1px, transparent 1px), linear-gradient(to bottom, hsl(217 32% 17% / 0.35) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="relative w-full max-w-md">
        <header className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            ITG — Institutional Trading Group
          </p>
          <h1 className="mt-2 text-3xl font-bold">ITG TraderOS</h1>
        </header>
        <section className="rounded-xl border bg-card p-6 shadow-lg sm:p-8">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {!configured && (
            <p role="alert" className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {supabaseNotConnectedMessage()}
            </p>
          )}
          <div className="mt-6">{children}</div>
        </section>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Your data stays yours. No real trades are executed by this system.
        </p>
      </div>
    </main>
  );
}
