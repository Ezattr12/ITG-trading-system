import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth";
import { supabase } from "../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GlassCard,
  LoadingState,
  Screen,
} from "../../src/components";
import { formatDate, formatMoney, titleCase } from "../../src/format";
import { shared, tokens } from "../../src/theme";
import type { TradeRow } from "../../src/types";

/**
 * Trades list — direct RLS read of the caller's own trades,
 * newest first, capped at 100. Read-only: trades are created
 * and managed in the web app in M2.
 */
const LIST_LIMIT = 100;

export default function TradesScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", session.user.id)
      .order("opened_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (queryError) {
      setError(queryError.message);
    } else {
      setTrades((data ?? []) as TradeRow[]);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading your trades…" />;

  return (
    <Screen>
      <Text style={shared.title}>Trades</Text>
      {error ? <ErrorState message={error} /> : null}
      {!error && trades.length === 0 ? (
        <EmptyState
          title="No trades yet"
          body="Trades you record in the ITG TraderOS web app will appear here."
        />
      ) : null}
      {trades.map((trade) => {
        const pnlColor =
          trade.pnl === null
            ? tokens.textMuted
            : trade.pnl >= 0
              ? tokens.profit
              : tokens.loss;
        return (
          <Pressable
            key={trade.id}
            accessibilityRole="button"
            onPress={() => router.push(`/(app)/trade/${trade.id}`)}
          >
            <GlassCard>
              <View style={shared.rowBetween}>
                <Text style={shared.heading}>{trade.pair}</Text>
                <Text style={{ color: pnlColor, fontSize: 16, fontWeight: "700" }}>
                  {trade.status === "closed" || trade.pnl !== null
                    ? formatMoney(trade.pnl)
                    : "Open"}
                </Text>
              </View>
              <View style={shared.rowBetween}>
                <Text
                  style={{
                    color: trade.direction === "long" ? tokens.profit : tokens.loss,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {titleCase(trade.direction)}
                  {trade.session ? ` · ${titleCase(trade.session)}` : ""}
                </Text>
                <Text style={shared.muted}>
                  {titleCase(trade.status)} · {formatDate(trade.opened_at)}
                </Text>
              </View>
            </GlassCard>
          </Pressable>
        );
      })}
    </Screen>
  );
}
