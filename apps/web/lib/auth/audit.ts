import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Append-only audit logging (Phase 2, spec §5 / §38).
 *
 * `audit_logs` has no client INSERT policy by design — rows are
 * written server-side only. This helper uses the service-role
 * client when available and fails silently otherwise: audit must
 * never break a login, and a missing service-role key (Supabase
 * not connected yet) must never be reported as a successful write.
 * Returns true only when a row was actually inserted.
 */
export async function writeAuditLog(input: {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}): Promise<boolean> {
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return false;
  const { error } = await admin.from("audit_logs").insert({
    user_id: input.userId ?? null,
    actor_id: input.userId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    details: input.details ?? {},
  });
  return !error;
}
