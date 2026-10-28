import type { ReactNode } from "react";
import { AmbientBackground } from "@/components/ambient-background";
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
 *
 * Atmosphere (Phase 18 Aurora): the page sits on the shared
 * `.app-ambient` layer (deep purple / violet / magenta wisp /
 * aurora blue orbs + faint grid), with large blurred aurora
 * lights of its own — a violet glow overhead, an aurora-blue
 * wash low on the left, a violet wash low on the right, and
 * a small magenta wisp top-right — plus two faint diagonal
 * light streaks rising past the card. The hero glass card
 * (white 0.12, blur 24px, 0.25 white border, clear top
 * reflection, deep shadow) floats over that light with a
 * violet gradient hairline along its top edge; the ITG tile
 * is a violet -> indigo gradient and the wordmark uses the
 * shared gradient text. Dark purple-black, large blurred
 * violet/blue/magenta lights, large translucent glass card,
 * soft reflection, deep shadow, premium ITG identity — the
 * strongest example of the glass aesthetic in the app, and
 * nothing of the SHRUHH login's branding, wording or layout.
 * The form, validation and behaviour are untouched; the
 * depth is in the surface and the background, not the
 * interaction.
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
      {/* Shared ambient layer (Phase 18): soft orbs + faint grid
          under the whole page. */}
      <AmbientBackground />
      <div
        aria-hidden="true"
        className="motion-login-grid pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(272 40% 20% / 0.35) 1px, transparent 1px), linear-gradient(to bottom, hsl(272 40% 20% / 0.35) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Soft aurora glow: a slow-drifting radial wash of violet
          with a faint magenta hint of the aurora. Large,
          blurred, low opacity — depth, not decoration. */}
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -top-32 left-[calc(50%-21rem)] h-96 w-[42rem] max-w-none rounded-full opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(265 48% 58% / 0.55), hsl(293 58% 35% / 0.18) 55%, transparent 75%)",
        }}
      />
      {/* Larger soft orbs (Phase 18 Aurora): an aurora-blue wash
          low on the left and a violet wash low on the right,
          drifting on the same slow transform-only animation,
          out of phase with the main glow so the backdrop never
          sits still, plus a small magenta wisp top-right —
          the pink/magenta accent stays atmospheric only.
          Accents only — purple-black stays the base. */}
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -bottom-40 -left-32 h-80 w-80 rounded-full bg-[#2971A4]/30 blur-3xl"
        style={{ animationDelay: "-14s" }}
      />
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -bottom-24 -right-32 h-96 w-96 rounded-full bg-[#8B60C7]/25 blur-3xl"
        style={{ animationDelay: "-7s" }}
      />
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#81268E]/20 blur-3xl"
        style={{ animationDelay: "-18s" }}
      />
      {/* Faint light streaks (Phase 18 Aurora): two thin, softly
          blurred diagonal beams rising past the card — violet
          and magenta on the right, aurora blue on the left.
          Transform-only drift, like the glow. */}
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -right-10 top-20 h-64 w-1.5 rotate-[28deg] rounded-full bg-gradient-to-b from-violet-300/25 via-[#81268E]/20 to-transparent blur-[1px]"
        style={{ animationDelay: "-21s" }}
      />
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -left-8 bottom-24 h-56 w-1 rotate-[28deg] rounded-full bg-gradient-to-b from-transparent via-[#2971A4]/20 to-[#346CE6]/25 blur-[1px]"
        style={{ animationDelay: "-3s" }}
      />
      <div className="motion-fade-in relative w-full max-w-md">
        <header className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-ai text-lg font-bold text-white shadow-elevation-2 ring-1 ring-white/15" aria-hidden="true">
            ITG
          </span>
          <p className="eyebrow mt-4 text-muted-foreground">
            ITG — Institutional Trading Group
          </p>
          <h1 className="page-title mt-2">ITG <span className="text-gradient-blue">TraderOS</span></h1>
        </header>
        <section className="card-surface-glass relative p-6 sm:p-8">
          {/* Gradient hairline along the card's top edge
              (Phase 18 Aurora): the bright edge that makes the
              glass read as a raised plane, strongest at the
              centre — violet now, the primary accent. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/70 to-transparent"
          />
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
