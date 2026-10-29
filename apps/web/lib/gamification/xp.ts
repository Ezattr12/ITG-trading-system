import { createHash } from "node:crypto";
import { XP_TABLE, calcXpFor, type XpAction } from "@itg/calc";
import type { XpHistoryPoint } from "@/lib/analytics/types";
import type { XpReason } from "./types";

/**
 * XP helpers (Phase 7, spec §24). Pure functions only: no I/O,
 * no Supabase. The actual inserts live in `actions.ts`, where
 * they go through the service-role client — `xp_transactions`
 * has no client INSERT policy (migration 0008, append-only),
 * so a signed-in-client insert silently fails (the bug Phase 3
 * shipped with; fixed in Phase 7).
 *
 * XP amounts are the spec §24 table, owned by `@itg/calc`
 * (`XP_TABLE`): trade journal +10, daily goal +20, backtesting
 * session +15, weekly review +30, risk discipline +25.
 * Achievements carry their own `xp_reward` (0 in the table).
 */

export { XP_TABLE, calcXpFor };
export type { XpAction };

export const XP_ACTION_LABELS: Record<XpAction, string> = {
  trade_journal: "Trade journal completed",
  daily_goal: "Daily goal completed",
  backtest_session: "Backtesting session",
  weekly_review: "Weekly review",
  risk_discipline: "Risk discipline",
  achievement: "Achievement unlocked",
};

export const XP_REASON_LABELS: Record<XpReason, string> = {
  trade_journal: "Trade journal completed",
  daily_goal: "Daily goal completed",
  backtest_session: "Backtesting session",
  weekly_review: "Weekly review",
  risk_discipline: "Risk discipline",
  achievement: "Achievement unlocked",
  penalty: "XP penalty",
  other: "Other",
};

/**
 * Derive a stable, valid UUID from an arbitrary string key.
 *
 * `xp_transactions.source_ref_id` is a Postgres `uuid` column,
 * so idempotency keys that are not natural row ids (e.g. one
 * backtesting session on a date) must be mapped into UUID
 * space deterministically: the same key always yields the
 * same UUID (so re-submitting never double-awards), and
 * different keys yield different UUIDs. MD5 digest shaped
 * into the RFC 4122 layout with version-5/variant bits —
 * the value only needs to be a valid, stable uuid, it is
 * never generated randomly or shown to users.
 *
 * (Stage 2 audit bug, 2026-10-29: the backtesting action
 * passed the raw key `backtest:<date>:<n>` as source_ref_id;
 * the uuid column rejected it, every insert failed silently
 * inside awardXp, and backtesting XP was never awarded.)
 */
export function deterministicUuid(key: string): string {
  const hex = createHash("md5").update(key).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-` +
    `${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/** Total XP from a list of transactions (penalties are negative). */
export function totalXp(
  transactions: readonly { amount: number }[],
): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Cumulative XP history, one point per transaction, in the
 * order given (callers pass oldest first). Used by the
 * dashboard / progress XP charts.
 */
export function aggregateXpHistory(
  transactions: readonly { amount: number; created_at: string }[],
): XpHistoryPoint[] {
  let running = 0;
  return transactions.map((row) => {
    running += row.amount;
    return {
      date: row.created_at.slice(0, 10),
      xp: row.amount,
      cumulativeXp: running,
    };
  });
}

/**
 * Validate an explicit XP penalty (spec §24: bad behaviour may
 * reduce XP only via an explicit, logged penalty — never
 * silently). Returns the problem, or null when the penalty is
 * valid. A penalty must be a negative whole number with a
 * written reason, so it can never be applied by accident.
 */
export function validatePenalty(
  amount: number,
  note: string | null | undefined,
): string | null {
  if (!Number.isInteger(amount)) return "A penalty must be a whole number of XP.";
  if (amount >= 0) return "A penalty must remove XP — the amount has to be negative.";
  if (!note || note.trim() === "") {
    return "A penalty needs a written reason — XP is never removed silently.";
  }
  return null;
}
