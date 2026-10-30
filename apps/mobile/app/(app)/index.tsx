import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../src/auth";
import { fetchSummary } from "../../src/api";
import { supabase } from "../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GlassCard,
  LoadingState,
  Screen,
  Stat,
} from "../../src/components";
import { formatMoney, formatNumber, formatPct } from "../../src/format";
import { shared, tokens } from "../../src/theme";
import type { SummaryResponse, UserLevelRow } from "../../src/types";

/**
 * Dashboard — this week's server-computed report summary
 * (GET /api/mobile/summary) plus the stored level/XP state
 * (user_levels + xp_transactions under RLS). Every number is
 * a stored/server-computed value; nothing is calculated here.
 */
export default function DashboardScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [level, setLevel] = useState<UserLevelRow | null>(null);
  const [xpTotal, setXpTotal] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const [sum, levelRes, xpRes, notifRes] = await Promise.all([
        fetchSummary("week"),
        supabase
          .from("user_levels")
          .select("score, score_breakdown, calculated_at, levels(name)")
          .eq("user_id", session.user.id)
          .maybeSingle(),
        supabase
          .from("xp_transactions")
          .select("amount")
          .eq("user_id", session.user.id)
          .limit(2000),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", session.user.id)
          .eq("is_read", false),
      ]);
      setSummary(sum);
      setLevel((levelRes.data as UserLevelRow | null) ?? null);
      const xpRows = (xpRes.data ?? []) as { amount: number }[];
      setXpTotal(xpRows.reduce((acc, r) => acc + (r.amount ?? 0), 0));
      setUnread(notifRes.count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);
  // Reload on focus so the unread count (and the summary)
  // reflect writes made on other screens — e.g. notifications
  // marked read on the Notifications screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) return <LoadingState label="Loading your dashboard…" />;
  if (error) {
    return (
      <Screen>
        <ErrorState message={error} />
      </Screen>
    );
  }

  const s = summary?.summary;
  const levelNameRaw = level?.levels;
  const levelName = Array.isArray(levelNameRaw)
    ? (levelNameRaw[0]?.name ?? null)
    : (levelNameRaw?.name ?? null);

  return (
    <Screen>
      <View style={shared.rowBetween}>
        <Text style={shared.title}>Dashboard</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/notifications")}
        >
          <Text
            style={{
              color: unread > 0 ? tokens.auroraCyan : tokens.textMuted,
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {unread > 0
              ? `${unread} unread notification${unread === 1 ? "" : "s"}`
              : "Notifications"}
          </Text>
        </Pressable>
      </View>
      <Text style={shared.muted}>
        Week of {summary?.period_start ?? "—"} to {summary?.period_end ?? "—"}
      </Text>

      {level || xpTotal !== null ? (
        <GlassCard hero>
          <Text style={shared.label}>Level & XP</Text>
          <View style={shared.rowBetween}>
            <Text style={[shared.statValue, { color: tokens.gold }]}>
              {levelName ?? "Not scored yet"}
            </Text>
            {level?.score !== null && level?.score !== undefined ? (
              <Text style={{ color: tokens.gold, fontSize: 15, fontWeight: "600" }}>
                Score {formatNumber(level.score, 1)}
              </Text>
            ) : null}
          </View>
          <Text style={shared.muted}>
            {xpTotal !== null ? `${xpTotal.toLocaleString("en-US")} XP earned` : "No XP yet"}
            {level?.calculated_at
              ? ` · Level updated ${new Date(level.calculated_at).toLocaleDateString("en-US")}`
              : ""}
          </Text>
        </GlassCard>
      ) : null}

      {s && s.tradesCount > 0 ? (
        <>
          <GlassCard hero>
            <Text style={shared.label}>Total P&L — this week</Text>
            <Text
              style={[
                shared.statValue,
                { color: s.totalPnl >= 0 ? tokens.profit : tokens.loss, fontSize: 34 },
              ]}
            >
              {formatMoney(s.totalPnl)}
            </Text>
            <Text style={shared.muted}>
              {s.tradesCount} closed trade{s.tradesCount === 1 ? "" : "s"} · {s.wins}W /{" "}
              {s.losses}L{s.breakeven > 0 ? ` / ${s.breakeven} BE` : ""}
            </Text>
          </GlassCard>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Stat label="Win rate" value={formatPct(s.winRate)} />
            <Stat label="Profit factor" value={formatNumber(s.profitFactor)} />
            <Stat label="Expectancy" value={formatMoney(s.expectancy)} />
            <Stat label="Average R" value={s.avgR === null ? "—" : formatNumber(s.avgR)} />
          </View>
        </>
      ) : (
        <EmptyState
          title="No closed trades this week"
          body="Record a trade from the Trades tab — once trades close, this week's performance appears here automatically."
        />
      )}
    </Screen>
  );
}
