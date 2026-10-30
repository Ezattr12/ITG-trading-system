import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "../../../src/auth";
import { supabase } from "../../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GlassCard,
  LoadingState,
  Screen,
} from "../../../src/components";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPct,
  titleCase,
} from "../../../src/format";
import { shared, tokens } from "../../../src/theme";
import type { LessonRow, PsychologyRow, TradeRow } from "../../../src/types";

/**
 * Trade detail — direct RLS reads: the trade row (all stored
 * fields and stored metrics), its psychology record and its
 * lessons, plus strategy/setup names. Read-only in M2.
 */
export default function TradeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [trade, setTrade] = useState<TradeRow | null>(null);
  const [psychology, setPsychology] = useState<PsychologyRow | null>(null);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [strategyName, setStrategyName] = useState<string | null>(null);
  const [setupName, setSetupName] = useState<string | null>(null);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    const { data, error: tradeError } = await supabase
      .from("trades")
      .select("*")
      .eq("id", id)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (tradeError) {
      setError(tradeError.message);
      setLoading(false);
      return;
    }
    const row = (data as TradeRow | null) ?? null;
    setTrade(row);
    if (row) {
      const [psychRes, lessonsRes, shotsRes, strategyRes, setupRes] = await Promise.all([
        supabase.from("psychology_records").select("*").eq("trade_id", id).maybeSingle(),
        supabase
          .from("lessons")
          .select("*")
          .eq("trade_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("trade_screenshots")
          .select("id", { count: "exact", head: true })
          .eq("trade_id", id),
        row.strategy_id
          ? supabase.from("strategies").select("id, name").eq("id", row.strategy_id).maybeSingle()
          : Promise.resolve({ data: null }),
        row.setup_id
          ? supabase.from("setups").select("id, name").eq("id", row.setup_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setPsychology((psychRes.data as PsychologyRow | null) ?? null);
      setLessons((lessonsRes.data ?? []) as LessonRow[]);
      setScreenshotCount(shotsRes.count ?? 0);
      setStrategyName((strategyRes.data as { name?: string } | null)?.name ?? null);
      setSetupName((setupRes.data as { name?: string } | null)?.name ?? null);
    }
    setLoading(false);
  }, [session, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading trade…" />;

  if (error) {
    return (
      <Screen>
        <ErrorState message={error} />
      </Screen>
    );
  }

  if (!trade) {
    return (
      <Screen>
        <EmptyState
          title="Trade not found"
          body="This trade doesn't exist, or it doesn't belong to your account."
        />
      </Screen>
    );
  }

  const fields: { label: string; value: string }[] = [
    { label: "Direction", value: titleCase(trade.direction) },
    { label: "Status", value: titleCase(trade.status) },
    { label: "Entry", value: formatNumber(trade.entry_price, 4) },
    { label: "Exit", value: formatNumber(trade.exit_price, 4) },
    { label: "Take profit", value: formatNumber(trade.tp, 4) },
    { label: "Stop loss", value: formatNumber(trade.sl, 4) },
    { label: "Position size", value: formatNumber(trade.position_size, 4) },
    { label: "Leverage", value: `${formatNumber(trade.leverage, 0)}x` },
    { label: "Fees", value: formatNumber(trade.fees) },
    { label: "Opened", value: formatDateTime(trade.opened_at) },
    { label: "Closed", value: formatDateTime(trade.closed_at) },
    { label: "Session", value: titleCase(trade.session) },
    { label: "Market", value: titleCase(trade.market_condition) },
    { label: "Reason", value: titleCase(trade.trade_reason) },
    { label: "Strategy", value: strategyName ?? "—" },
    { label: "Setup", value: setupName ?? "—" },
    { label: "Screenshots", value: String(screenshotCount) },
  ];

  const metrics: { label: string; value: string; tone?: "profit" | "loss" }[] = [
    {
      label: "P&L",
      value: formatMoney(trade.pnl),
      tone: trade.pnl === null ? undefined : trade.pnl >= 0 ? "profit" : "loss",
    },
    { label: "ROI", value: formatPct(trade.roi_pct) },
    { label: "R multiple", value: formatNumber(trade.r_multiple) },
    { label: "Risk / reward", value: formatNumber(trade.risk_reward) },
    {
      label: "Outcome",
      value: trade.is_win === null ? "—" : trade.is_win ? "Win" : "Loss / breakeven",
    },
  ];

  return (
    <Screen>
      <Text style={shared.title}>{trade.pair}</Text>
      <GlassCard hero>
        <Text style={shared.label}>Result</Text>
        {metrics.map((m) => (
          <View key={m.label} style={shared.rowBetween}>
            <Text style={shared.muted}>{m.label}</Text>
            <Text
              style={{
                color:
                  m.tone === "profit"
                    ? tokens.profit
                    : m.tone === "loss"
                      ? tokens.loss
                      : tokens.textPrimary,
                fontSize: 15,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              }}
            >
              {m.value}
            </Text>
          </View>
        ))}
      </GlassCard>

      <GlassCard>
        <Text style={shared.heading}>Trade details</Text>
        {fields.map((f) => (
          <View key={f.label} style={shared.rowBetween}>
            <Text style={shared.muted}>{f.label}</Text>
            <Text style={{ color: tokens.textSecondary, fontSize: 14 }}>{f.value}</Text>
          </View>
        ))}
        {trade.notes ? <Text style={shared.body}>{trade.notes}</Text> : null}
      </GlassCard>

      {psychology ? (
        <GlassCard>
          <Text style={shared.heading}>Psychology</Text>
          <View style={shared.rowBetween}>
            <Text style={shared.muted}>Emotion</Text>
            <Text style={{ color: tokens.textSecondary }}>{titleCase(psychology.emotion)}</Text>
          </View>
          <View style={shared.rowBetween}>
            <Text style={shared.muted}>Confidence</Text>
            <Text style={{ color: tokens.textSecondary }}>
              {psychology.confidence === null ? "—" : `${psychology.confidence} / 5`}
            </Text>
          </View>
          <View style={shared.rowBetween}>
            <Text style={shared.muted}>Discipline</Text>
            <Text style={{ color: tokens.textSecondary }}>{titleCase(psychology.discipline)}</Text>
          </View>
        </GlassCard>
      ) : null}

      {lessons.length > 0 ? (
        <GlassCard>
          <Text style={shared.heading}>Lessons</Text>
          {lessons.map((lesson) => (
            <Text key={lesson.id} style={shared.body}>
              • {lesson.text}
              {lesson.is_repeated_mistake ? " (repeated mistake)" : ""}
            </Text>
          ))}
        </GlassCard>
      ) : null}
    </Screen>
  );
}
