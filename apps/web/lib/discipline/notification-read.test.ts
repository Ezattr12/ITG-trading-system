import { describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * Notification read cores (Phase 21, M2 extraction of
 * markNotificationReadAction / markAllNotificationsReadAction):
 * owner scoping is the contract — another trader's row is
 * not_found, mark-all counts only the rows it flips.
 */

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("cores receive their client explicitly");
  },
  createServiceRoleSupabaseClient: () => null,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import {
  markAllNotificationsReadCore,
  markNotificationReadCore,
} from "./service";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function setup() {
  const tables: Record<string, Row[]> = {
    notifications: [
      { id: "n1", user_id: USER_A, is_read: false },
      { id: "n2", user_id: USER_A, is_read: true },
      { id: "n3", user_id: USER_B, is_read: false },
    ],
  };
  return { ...fakeSupabase(tables), tables };
}

describe("markNotificationReadCore", () => {
  it("marks the caller's notification read", async () => {
    const { client, tables } = setup();
    const res = await markNotificationReadCore(client, USER_A, "n1");
    expect(res).toEqual({ ok: true, updated: 1 });
    expect(tables.notifications.find((n) => n.id === "n1")?.is_read).toBe(true);
  });

  it("another trader's notification → not_found, row untouched", async () => {
    const { client, tables } = setup();
    const res = await markNotificationReadCore(client, USER_A, "n3");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
    expect(tables.notifications.find((n) => n.id === "n3")?.is_read).toBe(false);
  });

  it("empty id → invalid_input with the web message", async () => {
    const { client } = setup();
    const res = await markNotificationReadCore(client, USER_A, "");
    expect(res).toEqual({
      ok: false,
      code: "invalid_input",
      error: "Choose a notification first.",
    });
  });
});

describe("markAllNotificationsReadCore", () => {
  it("flips only the caller's unread rows and counts them", async () => {
    const { client, tables } = setup();
    const res = await markAllNotificationsReadCore(client, USER_A);
    expect(res).toEqual({ ok: true, updated: 1 });
    expect(tables.notifications.find((n) => n.id === "n3")?.is_read).toBe(false);
  });

  it("nothing unread → updated 0 (not an error)", async () => {
    const { client } = setup();
    await markAllNotificationsReadCore(client, USER_A);
    const res = await markAllNotificationsReadCore(client, USER_A);
    expect(res).toEqual({ ok: true, updated: 0 });
  });
});
