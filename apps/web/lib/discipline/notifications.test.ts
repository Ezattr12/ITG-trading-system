import { describe, expect, it } from "vitest";
import { countUnread, sortNotifications, unreadNotifications } from "./notifications";
import type { NotificationItem } from "./types";

function item(partial: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1",
    user_id: "user-1",
    type: "journal_reminder",
    title: "Reminder",
    body: null,
    is_read: false,
    related_entity_type: null,
    related_entity_id: null,
    created_at: "2026-10-27T10:00:00Z",
    ...partial,
  };
}

describe("sortNotifications / countUnread", () => {
  it("orders newest first", () => {
    const sorted = sortNotifications([
      item({ id: "old", created_at: "2026-10-25T10:00:00Z" }),
      item({ id: "new", created_at: "2026-10-27T10:00:00Z" }),
      item({ id: "mid", created_at: "2026-10-26T10:00:00Z" }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["new", "mid", "old"]);
  });

  it("counts unread only", () => {
    const items = [
      item({ id: "a", is_read: false }),
      item({ id: "b", is_read: true }),
      item({ id: "c", is_read: false }),
    ];
    expect(countUnread(items)).toBe(2);
    expect(unreadNotifications(items).map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("handles an empty list", () => {
    expect(sortNotifications([])).toEqual([]);
    expect(countUnread([])).toBe(0);
  });
});
