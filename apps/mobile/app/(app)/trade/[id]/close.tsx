import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "react-native";
import { correctTrade } from "../../../../src/api";
import { EmptyState, ErrorState, GlassCard, LoadingState, Screen } from "../../../../src/components";
import { supabase } from "../../../../src/supabase";
import { QuickTradeForm } from "../../../../src/trade-form";
import { shared } from "../../../../src/theme";
import type { TradeRow } from "../../../../src/types";

/**
 * Close Trade (Phase 25) — POST /api/mobile/trades/[id]/correct.
 *
 * Why a close goes through the CORRECT endpoint: TraderOS
 * has no in-place trade update — financial fields of a trade
 * are never overwritten (the same rule the web app follows).
 * Closing an open trade therefore uses correctTradeCore with
 * the trade's own values plus the exit price and close time:
 * the core creates the closed trade and marks the original
 * open trade as reversed, keeping the audit trail intact.
 * See docs/phase-25.md.
 */
export default function CloseTradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [trade, setTrade] = useState<TradeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const { data, error: readError } = await supabase
      .from("trades")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (readError) setError(readError.message);
    else setTrade((data as TradeRow | null) ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      <Text style={shared.title}>Close trade</Text>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : !trade ? (
        <EmptyState title="Trade not found" body="This trade could not be loaded." />
      ) : trade.status !== "open" ? (
        <EmptyState
          title="This trade is not open"
          body="Only an open trade can be closed. A closed trade is corrected with a reversal instead."
        />
      ) : (
        <GlassCard>
          <Text style={shared.body}>
            Closing records the exit on a new trade and marks this open trade as reversed —
            the same correction mechanics the web app uses, so nothing is ever overwritten.
          </Text>
          <QuickTradeForm
            initial={trade}
            requireExit
            submitLabel="Close trade"
            onSubmit={async (payload) => {
              const result = await correctTrade(trade.id, payload);
              router.replace(`/(app)/trade/${result.trade_id}`);
            }}
          />
        </GlassCard>
      )}
    </Screen>
  );
}
