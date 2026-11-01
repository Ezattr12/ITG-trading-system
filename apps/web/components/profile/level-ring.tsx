import type { CSSProperties } from "react";

/**
 * Level ring (Master Web UI Redesign — v2 ring).
 *
 * The conic-gradient fill is driven by `--itg-ring-pct`, set
 * inline from the trader's real progress through the current
 * level band (score progress from `progressToNextLevel`) —
 * never a hardcoded percentage. The arc runs blue -> cyan
 * over a deep-blue track and the inner content sits above
 * the deep-glass ::after disc via `.itg2-ring-content`.
 * Shared by the Dashboard and the Profile page — both
 * inherit this rendering.
 */
export function LevelRing({
  progressPct,
  levelName,
  score,
}: {
  /** 0–100 progress through the current level's band. */
  progressPct: number;
  levelName: string | null;
  /** Multi-dimensional score 0–100, or null with no data yet. */
  score: number | null;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progressPct)));
  return (
    <div
      className="itg2-ring"
      style={{ "--itg-ring-pct": pct } as CSSProperties}
      role="img"
      aria-label={
        levelName === null
          ? "No level yet — journal trades to earn a level"
          : `${levelName} level, score ${score ?? "—"} out of 100, ${pct}% of the way to the next level`
      }
    >
      <div className="itg2-ring-content">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Level
        </span>
        <span className="max-w-[76px] truncate text-sm font-bold leading-tight">
          {levelName ?? "—"}
        </span>
        <span className="tnum text-[11px] text-muted-foreground">
          {score === null ? "No score" : `${score.toFixed(1)} / 100`}
        </span>
      </div>
    </div>
  );
}
