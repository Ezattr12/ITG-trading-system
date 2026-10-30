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
 * Correct Trade (Phase 25) — POST /api/mobile/trades/[id]/correct.
 * Full-form, pre-filled from the RLS read. Saving never
 * overwrites the original: the core creates the corrected
 * trade and marks this one reversed (audit trail preserved).
 */
export default function CorrectTradeScreen() {
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

  const editable = trade !== null && (trade.status === "open" || trade.status === "closed");

  return (
    <Screen>
      <Text style={shared.title}>Correct trade</Text>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : !trade ? (
        <EmptyState title="Trade not found" body="This trade could not be loaded." />
      ) : !editable ? (
        <EmptyState
          title="This trade cannot be corrected"
          body="A reversed or cancelled trade is final — it is already part of the audit trail."
        />
      ) : (
        <GlassCard>
          <Text style={shared.body}>
            Corrections never overwrite the original: saving creates a new trade and marks
            this one as reversed, so the audit trail stays intact.
          </Text>
          <QuickTradeForm
            initial={trade}
            submitLabel="Save correction (creates a reversal)"
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
