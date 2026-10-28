/**
 * In-app notifications, listing logic (Phase 6, spec §30).
 *
 * Pure functions over the rows the server already read (RLS
 * enforces that a trader only ever sees their own). In-app only —
 * no email / SMS yet. Notification rows are created server-side
 * when discipline reminders escalate, goals are completed, or
 * risk events occur (see lib/discipline/actions.ts); this module
 * only orders and counts them.
 */

import type { NotificationItem } from "./types";

/** Newest first; unread first on ties (same created_at). */
export function sortNotifications(
  items: NotificationItem[],
): NotificationItem[] {
  return [...items].sort((a, b) => {
    const byDate = b.created_at.localeCompare(a.created_at);
    if (byDate !== 0) return byDate;
    return Number(a.is_read) - Number(b.is_read);
  });
}

export function countUnread(items: NotificationItem[]): number {
  return items.filter((item) => !item.is_read).length;
}

export function unreadNotifications(items: NotificationItem[]): NotificationItem[] {
  return sortNotifications(items.filter((item) => !item.is_read));
}
