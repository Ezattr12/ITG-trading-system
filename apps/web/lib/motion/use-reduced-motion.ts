"use client";

import { useEffect, useState } from "react";

/**
 * prefers-reduced-motion hook (Phase 16). JavaScript-driven
 * motion (count-up, chart animation) must respect the setting
 * too — CSS alone cannot switch those off. Returns false on
 * the server and on first paint, then the real value; the
 * components that use it render the final value immediately
 * when reduced motion is on, so nothing is ever hidden waiting
 * for an animation that will not run.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
