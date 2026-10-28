import { describe, expect, it, vi } from "vitest";
import { ADMIN_AUDIT_ACTIONS, writeAdminAuditLog } from "./audit";

/** Minimal mock of the Supabase client surface the audit writer needs. */
function mockClient() {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe("audit_logs");
      return {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          inserts.push(row);
          return { error: null };
        }),
      };
    }),
  };
  return { client, inserts };
}

describe("writeAdminAuditLog", () => {
  it("records admin as actor and trader as target, with action, entity and reason", async () => {
    const { client, inserts } = mockClient();
    const ok = await writeAdminAuditLog(client, {
      actorId: "admin-1",
      targetUserId: "trader-2",
      action: ADMIN_AUDIT_ACTIONS.roleChange,
      entityType: "profile",
      entityId: "trader-2",
      reason: "Promoted to admin.",
      details: { from: "trader", to: "admin" },
    });
    expect(ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      user_id: "trader-2",
      actor_id: "admin-1",
      action: "admin.role_change",
      entity_type: "profile",
      entity_id: "trader-2",
      details: { reason: "Promoted to admin.", from: "trader", to: "admin" },
    });
  });

  it("writes a certificate-revoke row with the required reason", async () => {
    const { client, inserts } = mockClient();
    const ok = await writeAdminAuditLog(client, {
      actorId: "admin-1",
      targetUserId: "trader-2",
      action: ADMIN_AUDIT_ACTIONS.certificateRevoke,
      entityType: "certificate",
      entityId: "cert-9",
      reason: "Criteria were met in error.",
      details: { certificate_id: "ITG-202610-ABCDEF" },
    });
    expect(ok).toBe(true);
    expect(inserts[0]?.action).toBe("admin.certificate_revoke");
    expect((inserts[0]?.details as Record<string, unknown>).reason).toBe(
      "Criteria were met in error.",
    );
  });

  it("writes a financial-view row so the view is auditable", async () => {
    const { client, inserts } = mockClient();
    const ok = await writeAdminAuditLog(client, {
      actorId: "admin-1",
      targetUserId: "trader-2",
      action: ADMIN_AUDIT_ACTIONS.financialView,
      entityType: "profile",
      entityId: "trader-2",
      reason: "Checking capital for verification review.",
    });
    expect(ok).toBe(true);
    expect(inserts[0]?.action).toBe("admin.financial_view");
    expect(inserts[0]?.actor_id).toBe("admin-1");
    expect(inserts[0]?.user_id).toBe("trader-2");
  });

  it("returns false when the insert fails, so the caller can refuse to present the change as done", async () => {
    const failing = {
      from: () => ({
        insert: async () => ({ error: new Error("insert failed") }),
      }),
    };
    const ok = await writeAdminAuditLog(failing, {
      actorId: "admin-1",
      action: ADMIN_AUDIT_ACTIONS.settingChange,
      entityType: "system_setting",
    });
    expect(ok).toBe(false);
  });

  it("covers every admin write action with a distinct name", () => {
    const names = Object.values(ADMIN_AUDIT_ACTIONS);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("admin.role_change");
    expect(names).toContain("admin.verification_change");
    expect(names).toContain("admin.certificate_revoke");
    expect(names).toContain("admin.achievement_change");
    expect(names).toContain("admin.level_change");
    expect(names).toContain("admin.setting_change");
    expect(names).toContain("admin.financial_view");
  });
});
