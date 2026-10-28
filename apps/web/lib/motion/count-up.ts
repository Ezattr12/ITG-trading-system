/**
 * Count-up math (Phase 16). Pure functions only, so they are
 * unit-tested here and the component in
 * components/analytics/count-up.tsx stays thin.
 *
 * The easing is ease-out cubic: fast at the start, settling
 * gently — the same curve as the CSS motion tokens
 * (--motion-ease-standard). Count-up runs 700ms by default,
 * which reads as instant feedback, not a decoration.
 */

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Value of a count-up from `from` to `to` at `elapsedMs` into a
 * `durationMs` animation. Clamped to the endpoints: before the
 * start it is `from`, after the end it is exactly `to`.
 */
export function countUpValue(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (durationMs <= 0) return to;
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return from + (to - from) * easeOutCubic(progress);
}
