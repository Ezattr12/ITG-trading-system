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
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION
 * ONLY: the surface moves to the v2 system. The card is
 * L2 v2 glass (.itg2-card .itg2-card-elevated) held flat
 * (.itg2-card-flat — a form must never move while it is
 * being filled in), the brand tile is the blue -> cyan
 * .itg2-brand-tile, the eyebrow and wordmark use
 * .itg2-eyebrow / .itg2-page-title, the card title is
 * .itg2-section-title, the top hairline is cyan, the
 * not-configured alert is .itg2-notice-warning, and this
 * shell's own aurora washes, grid and light streaks move
 * from the Phase 18 violet/magenta family into the v2
 * deep-blue / royal-blue / cyan family — violet is the
 * AI Coach identity and appears nowhere in the auth
 * forms. The shared AmbientBackground layer, the form,
 * validation and behaviour are untouched.
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
            "linear-gradient(to right, hsl(217 45% 22% / 0.35) 1px, transparent 1px), linear-gradient(to bottom, hsl(217 45% 22% / 0.35) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Soft aurora glow: a slow-drifting radial wash of royal
          blue with a faint cyan hint (v2 palette — the Phase 18
          violet/magenta wash retired with the redesign). Large,
          blurred, low opacity — depth, not decoration. */}
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -top-32 left-[calc(50%-21rem)] h-96 w-[42rem] max-w-none rounded-full opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(217 85% 55% / 0.5), hsl(199 100% 50% / 0.16) 55%, transparent 75%)",
        }}
      />
      {/* Larger soft orbs: a royal-blue wash low on the left
          and a bright-blue wash low on the right, drifting on
          the same slow transform-only animation, out of phase
          with the main glow so the backdrop never sits still,
          plus a small cyan wisp top-right — the cyan accent
          stays atmospheric only. Accents only — deep black
          and deep blue stay the base. */}
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -bottom-40 -left-32 h-80 w-80 rounded-full bg-[#1268D8]/30 blur-3xl"
        style={{ animationDelay: "-14s" }}
      />
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -bottom-24 -right-32 h-96 w-96 rounded-full bg-[#2E7CF6]/25 blur-3xl"
        style={{ animationDelay: "-7s" }}
      />
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#00CFFF]/15 blur-3xl"
        style={{ animationDelay: "-18s" }}
      />
      {/* Faint light streaks: two thin, softly blurred
          diagonal beams rising past the card — pale blue into
          royal blue on the right, royal into bright blue on
          the left. Transform-only drift, like the glow. */}
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -right-10 top-20 h-64 w-1.5 rotate-[28deg] rounded-full bg-gradient-to-b from-[#9CC2FF]/25 via-[#1268D8]/20 to-transparent blur-[1px]"
        style={{ animationDelay: "-21s" }}
      />
      <div
        aria-hidden="true"
        className="motion-login-glow pointer-events-none absolute -left-8 bottom-24 h-56 w-1 rotate-[28deg] rounded-full bg-gradient-to-b from-transparent via-[#1268D8]/20 to-[#2E7CF6]/25 blur-[1px]"
        style={{ animationDelay: "-3s" }}
      />
      <div className="motion-fade-in relative w-full max-w-md">
        <header className="mb-6 text-center">
          <span className="itg2-brand-tile mx-auto flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white" aria-hidden="true">
            ITG
          </span>
          <p className="itg2-eyebrow mt-4">
            ITG — Institutional Trading Group
          </p>
          <h1 className="itg2-page-title mt-2">ITG <span className="text-gradient-blue">TraderOS</span></h1>
        </header>
        <section className="itg2-card itg2-card-elevated itg2-card-flat relative p-6 sm:p-8">
          {/* Gradient hairline along the card's top edge:
              the bright edge that makes the glass read as a
              raised plane, strongest at the centre — cyan
              in the v2 system. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#00CFFF]/70 to-transparent"
          />
          <h2 className="itg2-section-title">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {!configured && (
            <p role="alert" className="itg2-notice itg2-notice-warning motion-fade-in mt-4">
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
