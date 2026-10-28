import type { ReactNode } from "react";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";

/**
 * Shared auth shell (Phase 2, spec §37): premium dark login page,
 * lightweight — no heavy 3D, fast by design. A subtle CSS-only
 * chart-like backdrop (no images, no WebGL) keeps it fast.
 *
 * Motion (Phase 16): the strongest motion in the app lives
 * here, and it is still restrained — a slow-drifting soft blue
 * glow and a grid that pans almost imperceptibly, plus a
 * fade-up entrance for the card. No particles, no neon, no
 * moving charts. Everything is CSS-only and disabled by the
 * reduced-motion rules; browsers also pause CSS animations in
 * hidden tabs, so the backdrop costs nothing when unseen.
 *
 * Depth (Phase 17): the card is now a glass surface — a
 * translucent, blurred layer with a brighter top edge and a
 * level-3 shadow — floating over the glow and grid, with the
 * ITG tile above the title for a clear brand mark. The form
 * inside is unchanged; the depth is in the surface only.
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
        className="motion-login-grid pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(217 32% 17% / 0.35) 1px, transparent 1px), linear-gradient(to bottom, hsl(217 32% 17% / 0.35) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Soft institutional glow: a slow-drifting radial wash of
          brand blue and a faint green/red hint of market depth.
          Large, blurred, low opacity — depth, not decoration. */}
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -top-32 left-[calc(50%-21rem)] h-96 w-[42rem] max-w-none rounded-full opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(217 91% 60% / 0.55), hsl(262 83% 68% / 0.18) 55%, transparent 75%)",
        }}
      />
      <div className="motion-fade-in relative w-full max-w-md">
        <header className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-elevation-2" aria-hidden="true">
            ITG
          </span>
          <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            ITG — Institutional Trading Group
          </p>
          <h1 className="mt-2 text-3xl font-bold">ITG TraderOS</h1>
        </header>
        <section className="card-surface-glass p-6 sm:p-8">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {!configured && (
            <p role="alert" className="motion-fade-in mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
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
