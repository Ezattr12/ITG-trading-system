import type { DbClient } from "./db.js";

/**
 * Audit logging (design §2.4): every tools/call writes exactly
 * one `audit_logs` row, mirroring the web app's writeAuditLog
 * (apps/web/lib/auth/audit.ts) field-for-field.
 *
 * The insert runs on the SERVICE-ROLE client — the only thing
 * that key is ever used for in this process (audit_logs has no
 * client INSERT policy by design). The service client is never
 * used to read trading data.
 *
 * Audit must never break a tool call: failures are swallowed
 * and reported as `false`, exactly like the web helper.
 */

export type AuditOutcome =
  | "ok"
  | "not_found"
  | "invalid_argument"
  | "unauthenticated"
  | "rate_limited"
  | "upstream_error";

export interface AuditEntry {
  /** Token user id; null when authentication failed. */
  userId: string | null;
  /** e.g. "mcp.get_trade". */
  action: string;
  entityType: string;
  /** The target trade id when a valid uuid was supplied, else null. */
  entityId: string | null;
  tool: string;
  outcome: AuditOutcome;
  durationMs: number;
  /** Ids only — never free text, never token material. */
  tradeId?: string | null;
  /**
   * Structured, non-free-text arguments for tools that do not
   * take a trade_id (Stage 4: dates, limits). When omitted, the
   * row records `{ trade_id }` exactly as Stage 3 did.
   */
  arguments?: Record<string, unknown>;
  correlationId: string;
}

export async function writeAuditLog(
  serviceClient: DbClient | null,
  entry: AuditEntry,
): Promise<boolean> {
  if (!serviceClient) return false;
  try {
    const { error } = await serviceClient.from("audit_logs").insert({
      user_id: entry.userId,
      actor_id: entry.userId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      details: {
        tool: entry.tool,
        outcome: entry.outcome,
        duration_ms: Math.round(entry.durationMs),
        correlation_id: entry.correlationId,
        arguments: entry.arguments ?? { trade_id: entry.tradeId ?? null },
      },
    });
    return !error;
  } catch {
    return false;
  }
}
