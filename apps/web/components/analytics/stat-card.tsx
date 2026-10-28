import type { ReactNode } from "react";
import { formatMoney } from "@/lib/trades/calculations";

/** One dashboard / analytics stat. Null values render "—", never 0. */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
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

/** Simple progress bar (goals, journal completion). Percent is capped at 100 for display. */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const shown = Math.min(100, Math.max(0, percent));
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
        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${shown}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
