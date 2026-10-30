import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { markNotificationsRead } from "../../src/api";
import {
  EmptyState,
  ErrorState,
  GhostButton,
  LoadingState,
  Screen,
} from "../../src/components";
import { formatDateTime } from "../../src/format";
import { FormError, FormSuccess } from "../../src/forms";
import { supabase } from "../../src/supabase";
import { shared, tokens } from "../../src/theme";
import type { NotificationRow } from "../../src/types";

/**
 * Notifications (Phase 25) — list from the RLS read, mark
 * read through POST /api/mobile/notifications/read (single
 * id, or { all: true }). The list is re-read from the server
 * after every change: read state shown is always the stored
 * state, never an optimistic guess. The Dashboard unread
 * count reads the same table and refreshes on focus.
 */
export default function NotificationsScreen() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: readError } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (readError) setError(readError.message);
    else setItems((data ?? []) as NotificationRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const unreadCount = items.filter((n) => !n.is_read).length;

  async function markOne(item: NotificationRow) {
    if (busy || item.is_read) return;
    setBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await markNotificationsRead({ notification_id: item.id });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function markAll() {
    if (busy || unreadCount === 0) return;
    setBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await markNotificationsRead({ all: true });
      setActionSuccess(`Marked ${result.updated} notification${result.updated === 1 ? "" : "s"} as read.`);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={shared.rowBetween}>
        <Text style={shared.title}>Notifications</Text>
        {unreadCount > 0 ? (
          <Text style={{ color: tokens.auroraCyan, fontWeight: "700" }}>
            {unreadCount} unread
          </Text>
        ) : null}
      </View>
      {unreadCount > 0 ? (
        <GhostButton label={busy ? "Working…" : "Mark all read"} onPress={markAll} />
      ) : null}
      <FormError message={actionError} />
      <FormSuccess message={actionSuccess} />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No notifications"
          body="Goal, level and coach notifications will appear here."
        />
      ) : (
        items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            disabled={busy || item.is_read}
            onPress={() => void markOne(item)}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
          >
            <View
              style={[
                shared.card,
                !item.is_read && { borderColor: tokens.glassBorderBright },
              ]}
            >
              <View style={shared.rowBetween}>
                <Text style={[shared.heading, { flex: 1 }]}>{item.title}</Text>
                {!item.is_read ? (
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor: tokens.auroraCyan,
                    }}
                  />
                ) : null}
              </View>
              {item.body ? <Text style={shared.body}>{item.body}</Text> : null}
              <Text style={shared.muted}>
                {formatDateTime(item.created_at)}
                {item.is_read ? "" : " · Tap to mark read"}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
