/**
 * Admin audit logging (Phase 10, spec §5, §10).
 *
 * Every admin action writes an `audit_logs` row with the ADMIN as
 * `actor_id`, the affected trader as `user_id`, the action, the
 * entity and the reason. This is separate from `writeAuditLog` in
 * lib/auth/audit.ts, which records a user acting on themselves
 * (actor == user) and cannot express "admin X did Y to trader Z".
 *
 * The client is injected so tests can pass a mock: the function
 * only needs a client with `.from("audit_logs").insert(...)`.
 * In production the caller passes the service-role client, because
 * `audit_logs` has no client INSERT policy by design (migration
 * 0010, append-only). Returns true only when a row was inserted.
 */

export interface AdminAuditInput {
  actorId: string;
  targetUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditInsertClient {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown | null }>;
  };
}

export async function writeAdminAuditLog(
  client: AuditInsertClient,
  input: AdminAuditInput,
): Promise<boolean> {
  const { error } = await client.from("audit_logs").insert({
    user_id: input.targetUserId ?? null,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    details: {
      reason: input.reason ?? null,
      ...(input.details ?? {}),
    },
  });
  return !error;
}

/** Action names used by every admin write, so the audit page and tests agree on them. */
export const ADMIN_AUDIT_ACTIONS = {
  roleChange: "admin.role_change",
  verificationChange: "admin.verification_change",
  certificateRevoke: "admin.certificate_revoke",
  achievementChange: "admin.achievement_change",
  levelChange: "admin.level_change",
  settingChange: "admin.setting_change",
  financialView: "admin.financial_view",
} as const;
