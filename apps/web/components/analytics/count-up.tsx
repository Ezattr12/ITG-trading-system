"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { countUpValue } from "@/lib/motion/count-up";
import { usePrefersReducedMotion } from "@/lib/motion/use-reduced-motion";
import { formatMoney } from "@/lib/trades/calculations";

/**
 * Animated numbers (Phase 16). KPI values count up from the
 * previous value over 700ms with the standard ease-out curve —
 * fast enough to feel instant, smooth enough to notice a
 * change. With prefers-reduced-motion the final value renders
 * immediately: the number is information, the animation is
 * not. Intermediate values are aria-live="off" so screen
 * readers only ever meet the final value.
 *
 * The first paint is the final value (correct for SSR and for
 * no-JS), and the animation resets to its start value in a
 * layout effect — before the browser paints the hydrated tree
 * — so the count-up never flickers from final to zero.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AnimatedNumber({
  value,
  format,
  durationMs = 700,
  className,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const previousRef = useRef(0);

  useIsomorphicLayoutEffect(() => {
    const from = previousRef.current;
    const to = value;
    if (reduced || from === to) {
      setDisplay(to);
      previousRef.current = to;
      return;
    }
    setDisplay(from);
    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const v = countUpValue(from, to, now - start, durationMs);
      setDisplay(v);
      previousRef.current = v;
      if (now - start < durationMs) {
        raf = requestAnimationFrame(step);
      } else {
        previousRef.current = to;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, reduced]);

  return (
    <span className={className} aria-live="off">
      {format(display)}
    </span>
  );
}

/** Signed money with the profit/loss colour of the FINAL value. */
export function CountUpMoney({ value }: { value: number }) {
  return (
    <span className={value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : ""}>
      <AnimatedNumber value={value} format={(n) => formatMoney(n)} />
    </span>
  );
}

/** Percentage with 1 decimal. */
export function CountUpPct({ value }: { value: number }) {
  return <AnimatedNumber value={value} format={(n) => `${n.toFixed(1)}%`} />;
}

/** Plain number with a fixed decimal count and an optional suffix. */
export function CountUpDecimal({
  value,
  decimals = 2,
  suffix = "",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  return (
    <AnimatedNumber
      value={value}
      format={(n) => `${n.toFixed(decimals)}${suffix}`}
    />
  );
}
