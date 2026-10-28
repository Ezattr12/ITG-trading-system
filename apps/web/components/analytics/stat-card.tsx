"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/trades/calculations";

/** One dashboard / analytics stat (Phase 15). Null values render "—", never 0.
 * Cards use the unified Phase 19 `.itg-stat` surface (docs/
 * phase-19.md): min-height 150px, 22px padding, 145deg glass
 * gradient, 24px radius, deep shadow, -5px hover lift with a
 * violet border — one system for the dashboard and analytics
 * pages, not a per-page card. The value is large, tabular and
 * tight-tracked (`.itg-stat-value`).
 *
 * `glow` adds one of the shared `.itg-stat-glow-*` modifiers.
 * The glow is always driven by the REAL value passed by the
 * page — emerald when a profit metric is positive, red when
 * it is negative, blue for a performance rate — never
 * hard-coded to a sign. Omit it (or pass undefined) and the
 * card stays neutral. `raised` lifts the card one level
 * (stronger border + shadow). `icon` renders a glowing
 * `.itg-icon` tile above the label (dashboard KPI icons). */
export type StatCardGlow = "blue" | "cyan" | "violet" | "emerald" | "danger" | "amber";

export const STAT_CARD_GLOW_CLASS: Record<StatCardGlow, string> = {
  blue: "itg-stat-glow-blue",
  cyan: "itg-stat-glow-cyan",
  violet: "itg-stat-glow-violet",
  emerald: "itg-stat-glow-emerald",
  danger: "itg-stat-glow-danger",
  amber: "itg-stat-glow-amber",
};

export function StatCard({
  label,
  value,
  hint,
  raised = false,
  glow,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  raised?: boolean;
  glow?: StatCardGlow;
  icon?: ReactNode;
}) {
  const glowClass = glow ? ` ${STAT_CARD_GLOW_CLASS[glow]}` : "";
  const raisedClass = raised ? " itg-stat-raised" : "";
  return (
    <article className={`itg-stat${raisedClass}${glowClass}`}>
      {icon ? <span className="itg-icon mb-3" aria-hidden="true">{icon}</span> : null}
      <h2 className="section-label">{label}</h2>
      <p className="itg-stat-value mt-1">{value}</p>
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
