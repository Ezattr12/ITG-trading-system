import { useRouter } from "expo-router";
import { Text } from "react-native";
import { createTrade } from "../../../src/api";
import { GlassCard, Screen } from "../../../src/components";
import { QuickTradeForm } from "../../../src/trade-form";
import { shared } from "../../../src/theme";

/**
 * Add Trade (Phase 25) — POST /api/mobile/trades.
 * Raw inputs only: P&L, R and ROI come back computed by the
 * server core. On success the app navigates to the created
 * trade (the id is the server's response, not a local guess).
 */
export default function AddTradeScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Text style={shared.title}>Add trade</Text>
      <GlassCard>
        <QuickTradeForm
          submitLabel="Save trade"
          onSubmit={async (payload) => {
            const result = await createTrade(payload);
            router.replace(`/(app)/trade/${result.trade.id}`);
          }}
        />
      </GlassCard>
    </Screen>
  );
}
