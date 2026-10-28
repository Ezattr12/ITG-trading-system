/*
 * AmbientBackground (Phase 18 Aurora). The fixed backdrop layer
 * for the whole app: four large radial-gradient orbs — deep
 * purple, violet, a small magenta wisp, aurora blue — plus an
 * extremely subtle grid, rendered behind the content
 * (`.app-ambient` is z-index -1 and pointer-events-none).
 *
 * Render once, as the first child of the app shell — other
 * workers place this, they do not build their own backdrop.
 * aria-hidden: the layer is purely decorative and carries no
 * information; the body background tints in globals.css are
 * the fallback if this component is ever absent.
 *
 * Performance: depth comes from gradient falloff, not
 * filter: blur on huge elements. The only animation is a very
 * slow transform-only drift (70s+), killed by the
 * prefers-reduced-motion rules in globals.css. One small
 * layer of large orbs — never dozens of independently
 * animated elements.
 *
 * Phase 19: the layer also carries Ezat's `.itg-aurora`
 * class name (globals.css) — his supplied aurora layer,
 * implemented here at z-index -1 (the supplied z-index: 0
 * would have painted the fixed layer over in-flow content).
 * One layer, two names; the profile page adds no second one.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden="true" className="app-ambient itg-aurora">
      <div className="app-ambient-orb app-ambient-orb-purple motion-orb-drift" />
      <div className="app-ambient-orb app-ambient-orb-violet motion-orb-drift motion-orb-drift-slow" />
      <div className="app-ambient-orb app-ambient-orb-magenta motion-orb-drift" />
      <div className="app-ambient-orb app-ambient-orb-blue motion-orb-drift motion-orb-drift-slow" />
      <div className="app-ambient-grid" />
    </div>
  );
}
