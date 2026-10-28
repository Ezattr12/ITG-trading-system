"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/trades/calculations";

/** One dashboard / analytics stat (Phase 15). Null values render "—", never 0.
 * Cards use the shared card surface, a clear label, a large primary
 * metric (24-32px) and small supporting context — never tiny
 * compressed cards. `raised` (Phase 17) lifts one card per view —
 * the primary KPI — onto the hero level of the elevation scale.
 *
 * `glow` (Phase 18) adds one of the shared `.card-glow-*`
 * modifiers. The glow is always driven by the REAL value passed
 * by the page — emerald when a profit metric is positive, red
 * when it is negative, blue for a performance rate — never
 * hard-coded to a sign. Omit it (or pass undefined) and the card
 * stays neutral. */
export type StatCardGlow = "blue" | "cyan" | "violet" | "emerald" | "danger" | "amber";

export const STAT_CARD_GLOW_CLASS: Record<StatCardGlow, string> = {
  blue: "card-glow-blue",
  cyan: "card-glow-cyan",
  violet: "card-glow-violet",
  emerald: "card-glow-emerald",
  danger: "card-glow-danger",
  amber: "card-glow-amber",
};

export function StatCard({
  label,
  value,
  hint,
  raised = false,
  glow,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  raised?: boolean;
  glow?: StatCardGlow;
}) {
  const glowClass = glow ? ` ${STAT_CARD_GLOW_CLASS[glow]}` : "";
  return (
    <article className={raised ? `card-surface-raised p-4 sm:p-5${glowClass}` : `card-surface p-4 sm:p-5${glowClass}`}>
      <h2 className="section-label">{label}</h2>
      <p className="metric-value">{value}</p>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </article>
  );
}

/** Signed money, coloured green/red. Null → "—". */
export function Money({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <>—</>;
  return (
    <span className={value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : ""}>
      {formatMoney(value)}
    </span>
  );
}

/** Percentage with 1 decimal. Null → "—". */
export function Pct({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <>—</>;
  return <>{value.toFixed(1)}%</>;
}

/** Simple progress bar (goals, journal completion). Percent is capped at 100 for display.
 * The fill animates from 0 to its value over 500ms after mount (Phase 16) — a
 * progress bar that fills reads as progress; one that appears full does not.
 * aria-valuenow is the final value from the first paint, so screen readers
 * always get the real number even while the visual fill is still moving. */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const shown = Math.min(100, Math.max(0, percent));
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(shown)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500 ease-standard"
          style={{ width: `${mounted ? shown : 0}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
