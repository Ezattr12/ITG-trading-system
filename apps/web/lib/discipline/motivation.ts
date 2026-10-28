/**
 * Motivation library (Phase 6, spec §23).
 *
 * Configurable, context-aware professional discipline messages.
 * Messages live in the `motivation_messages` table (seeded config,
 * admin-editable); this module only *selects* from the rows it is
 * given — it never invents copy. Selection prefers the requested
 * context, falls back to "general", never repeats the message the
 * trader saw last when another one is available, and rotates by
 * day so the same message does not greet the trader every visit.
 */

import type { MotivationContext, MotivationMessage } from "./types";

/** Deterministic small hash (FNV-1a) — stable across renders. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash);
}

/**
 * Pick one motivation message for a context.
 * Returns null when there are no active messages at all.
 */
export function selectMotivationMessage(
  messages: MotivationMessage[],
  context: MotivationContext,
  lastMessageId: string | null,
  today: string,
): MotivationMessage | null {
  const active = messages.filter((m) => m.is_active);
  if (active.length === 0) return null;

  const forContext = active.filter((m) => m.context === context);
  const pool = forContext.length > 0 ? forContext : active.filter((m) => m.context === "general");
  const candidates = pool.length > 0 ? pool : active;

  const fresh = candidates.filter((m) => m.id !== lastMessageId);
  const usable = fresh.length > 0 ? fresh : candidates;
  const index = hashString(`${context}:${today}`) % usable.length;
  return usable[index];
}

/** Context for a trader's current situation, for message selection. */
export function motivationContextFor(input: {
  missedDays: number | null;
  goalNearCompletion: boolean;
  disciplinedStreak: number;
  hadLossToday: boolean;
}): MotivationContext {
  if (input.goalNearCompletion) return "goal_near";
  if (input.missedDays !== null && input.missedDays >= 1) return "missed_day";
  if (input.hadLossToday) return "after_loss";
  if (input.disciplinedStreak >= 3) return "streak";
  return "general";
}
