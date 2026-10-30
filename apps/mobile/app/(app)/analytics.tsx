import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fetchSummary } from "../../src/api";
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
import type { BreakdownRow, SummaryRange, SummaryResponse } from "../../src/types";

/**
 * Analytics — the web report engine's aggregates via
 * GET /api/mobile/summary (week/month). The server computes
 * every number from real trades; this screen only renders
 * fields that exist in the ReportSummary contract.
 */
export default function AnalyticsScreen() {
  const [range, setRange] = useState<SummaryRange>("week");
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSummary(range));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = data?.summary;
  const bestStrategy = s && s.byStrategy.length > 0
    ? [...s.byStrategy].sort((a, b) => b.totalPnl - a.totalPnl)[0]
    : null;
  const worstStrategy = s && s.byStrategy.length > 1
    ? [...s.byStrategy].sort((a, b) => a.totalPnl - b.totalPnl)[0]
    : null;

  return (
    <Screen>
      <Text style={shared.title}>Analytics</Text>
      <View style={styles.toggleRow}>
        {(["week", "month"] as SummaryRange[]).map((r) => (
          <Pressable
            key={r}
            accessibilityRole="button"
            onPress={() => setRange(r)}
            style={[styles.toggle, range === r && styles.toggleActive]}
          >
            <Text
              style={{
                color: range === r ? tokens.textPrimary : tokens.textMuted,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {r === "week" ? "This week" : "This month"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? <LoadingState label="Loading analytics…" /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && s && s.tradesCount === 0 ? (
        <EmptyState
          title={`No closed trades this ${range}`}
          body="Analytics are computed from your real closed trades. Once trades close in this period, the full breakdown will appear here."
        />
      ) : null}

      {!loading && !error && s && s.tradesCount > 0 ? (
        <>
          <GlassCard hero>
            <Text style={shared.label}>Net P&L</Text>
            <Text
              style={[
                shared.statValue,
                { color: s.totalPnl >= 0 ? tokens.profit : tokens.loss, fontSize: 32 },
              ]}
            >
              {formatMoney(s.totalPnl)}
            </Text>
            <Text style={shared.muted}>
              {data?.period_start} → {data?.period_end} · {s.tradesCount} trades · {s.wins}W /{" "}
              {s.losses}L{s.breakeven > 0 ? ` / ${s.breakeven} BE` : ""}
            </Text>
          </GlassCard>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Stat label="Win rate" value={formatPct(s.winRate)} />
            <Stat label="Profit factor" value={formatNumber(s.profitFactor)} />
            <Stat label="Expectancy" value={formatMoney(s.expectancy)} />
            <Stat label="Average R" value={formatNumber(s.avgR)} />
            <Stat label="Average win" value={formatMoney(s.avgWin)} tone="profit" />
            <Stat label="Average loss" value={formatMoney(s.avgLoss)} tone="loss" />
            <Stat label="Journal completion" value={formatPct(s.journalCompletionPct)} />
            <Stat label="Discipline" value={formatPct(s.disciplinePct)} />
          </View>

          {bestStrategy ? (
            <GlassCard>
              <Text style={shared.heading}>Strategies</Text>
              <BreakdownRows rows={s.byStrategy} />
            </GlassCard>
          ) : null}

          {s.bySession.length > 0 ? (
            <GlassCard>
              <Text style={shared.heading}>Sessions</Text>
              <BreakdownRows rows={s.bySession} />
            </GlassCard>
          ) : null}

          {bestStrategy || worstStrategy ? (
            <GlassCard>
              <Text style={shared.heading}>Best & worst</Text>
              {bestStrategy ? (
                <Text style={shared.body}>
                  Best strategy: {bestStrategy.name} ({formatMoney(bestStrategy.totalPnl)})
                </Text>
              ) : null}
              {worstStrategy && worstStrategy.name !== bestStrategy?.name ? (
                <Text style={shared.body}>
                  Weakest strategy: {worstStrategy.name} ({formatMoney(worstStrategy.totalPnl)})
                </Text>
              ) : null}
              {s.mostFrequentLosingSetup ? (
                <Text style={shared.body}>
                  Most frequent losing setup: {s.mostFrequentLosingSetup.name} (
                  {s.mostFrequentLosingSetup.losses} losses)
                </Text>
              ) : null}
              {s.mostRepeatedMistake ? (
                <Text style={shared.body}>
                  Most repeated mistake: “{s.mostRepeatedMistake.text}” (×
                  {s.mostRepeatedMistake.count})
                </Text>
              ) : null}
            </GlassCard>
          ) : null}

          <GlassCard>
            <Text style={shared.heading}>Goals</Text>
            <Text style={shared.body}>
              {s.goalsCompleted} of {s.goalsTotal} goals completed in this period.
            </Text>
          </GlassCard>
        </>
      ) : null}
    </Screen>
  );
}

function BreakdownRows({ rows }: { rows: BreakdownRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <View key={row.name} style={shared.rowBetween}>
          <Text style={{ color: tokens.textSecondary, fontSize: 14 }}>{row.name}</Text>
          <Text style={{ color: tokens.textMuted, fontSize: 13 }}>
            {row.trades} trades · {formatPct(row.winRate)} ·{" "}
            <Text
              style={{ color: row.totalPnl >= 0 ? tokens.profit : tokens.loss, fontWeight: "600" }}
            >
              {formatMoney(row.totalPnl)}
            </Text>
          </Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: "row",
    gap: 8,
  },
  toggle: {
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: tokens.glass,
  },
  toggleActive: {
    backgroundColor: tokens.violet,
    borderColor: tokens.glassBorderBright,
  },
});
