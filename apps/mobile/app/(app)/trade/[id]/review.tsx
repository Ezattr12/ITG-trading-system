import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { saveTradeReview } from "../../../../src/api";
import {
  EmptyState,
  ErrorState,
  GlassCard,
  LoadingState,
  Screen,
} from "../../../../src/components";
import {
  ChipSelect,
  SubmitBar,
  TextField,
  textOrNull,
} from "../../../../src/forms";
import {
  DISCIPLINE_OPTIONS,
  EMOTION_OPTIONS,
  MARKET_CONDITION_OPTIONS,
  SESSION_OPTIONS,
  TRADE_REASON_OPTIONS,
} from "../../../../src/options";
import { supabase } from "../../../../src/supabase";
import { shared } from "../../../../src/theme";
import type {
  AdvancedReviewPayload,
  DisciplineName,
  EmotionName,
  MarketCondition,
  PsychologyRow,
  SetupRow,
  StrategyRow,
  TradeReason,
  TradeRow,
  TradingSessionName,
} from "../../../../src/types";

/**
 * Trade Review — journal + psychology (Phase 25)
 * POST /api/mobile/trades/[id]/review.
 *
 * ⚠ FULL-FORM SAVE — the Phase 24 requirement. The review
 * core overwrites strategy_id, setup_id, market_condition,
 * trade_reason, session and notes on the trade, and upserts
 * the psychology record with exactly what is sent. This
 * screen therefore pre-fills EVERY field from the current
 * trade + psychology reads and always sends the complete
 * payload: strategyId round-trips the trade's current
 * strategy, and setupName round-trips the NAME of the
 * trade's current setup (the core resolves the name back to
 * the setup row, creating it only when the name is new).
 * Sending strategyId / setupName as null by accident would
 * CLEAR them — that already happened once during Phase 23
 * verification (see docs/phase-24.md production addendum).
 */
export default function ReviewTradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [trade, setTrade] = useState<TradeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Full-form state — every field pre-filled from the reads.
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [setupName, setSetupName] = useState("");
  const [marketCondition, setMarketCondition] = useState<MarketCondition | null>(null);
  const [tradeReason, setTradeReason] = useState<TradeReason | null>(null);
  const [session, setSession] = useState<TradingSessionName | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [emotion, setEmotion] = useState<EmotionName | null>(null);
  const [discipline, setDiscipline] = useState<DisciplineName | null>(null);
  const [lesson, setLesson] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [tradeRes, psychRes, setupsRes, strategiesRes] = await Promise.all([
      supabase.from("trades").select("*").eq("id", id).maybeSingle(),
      supabase.from("psychology_records").select("*").eq("trade_id", id).maybeSingle(),
      supabase.from("setups").select("id, strategy_id, name"),
      supabase.from("strategies").select("id, name, description, is_system").order("name"),
    ]);
    if (tradeRes.error) {
      setError(tradeRes.error.message);
      setLoading(false);
      return;
    }
    const loaded = (tradeRes.data as TradeRow | null) ?? null;
    setTrade(loaded);
    if (loaded) {
      const psych = (psychRes.data as PsychologyRow | null) ?? null;
      const setups = (setupsRes.data ?? []) as SetupRow[];
      setStrategies((strategiesRes.data ?? []) as StrategyRow[]);
      // Round-trip: current values, exactly as stored.
      setStrategyId(loaded.strategy_id);
      const currentSetup = setups.find((s) => s.id === loaded.setup_id) ?? null;
      setSetupName(currentSetup?.name ?? "");
      setMarketCondition((loaded.market_condition as MarketCondition | null) ?? null);
      setTradeReason((loaded.trade_reason as TradeReason | null) ?? null);
      setSession((loaded.session as TradingSessionName | null) ?? null);
      setNotes(loaded.notes ?? "");
      setConfidence(psych?.confidence ?? null);
      setEmotion((psych?.emotion as EmotionName | null) ?? null);
      setDiscipline((psych?.discipline as DisciplineName | null) ?? null);
      setLesson("");
    }
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

  async function handleSubmit() {
    if (!trade || submitting) return;
    const payload: AdvancedReviewPayload = {
      strategyId,
      setupName: textOrNull(setupName),
      marketCondition,
      tradeReason,
      session,
      confidence,
      emotion,
      discipline,
      lesson: textOrNull(lesson),
      notes: textOrNull(notes),
    };
    setSubmitError(null);
    setSubmitting(true);
    try {
      await saveTradeReview(trade.id, payload);
      router.replace(`/(app)/trade/${trade.id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  const reviewable =
    trade !== null && trade.status !== "reversed" && trade.status !== "cancelled";

  return (
    <Screen>
      <Text style={shared.title}>Review trade</Text>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : !trade ? (
        <EmptyState title="Trade not found" body="This trade could not be loaded." />
      ) : !reviewable ? (
        <EmptyState
          title="This trade cannot be reviewed"
          body={
            trade.status === "reversed"
              ? "This trade was corrected by a reversal — review the correcting trade instead."
              : "A cancelled trade cannot be reviewed."
          }
        />
      ) : (
        <GlassCard>
          <View style={{ gap: 14 }}>
            <Text style={shared.body}>
              Journal and psychology for {trade.pair}. Every field is pre-filled with the
              trade's current values — saving writes the full form back, exactly like web.
            </Text>
            <ChipSelect
              label="Strategy"
              options={[
                { value: "", label: "No strategy" },
                ...strategies.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={strategyId ?? ""}
              onChange={(value) =>
                setStrategyId(value === "" || value === null ? null : value)
              }
            />
            <TextField
              label="Setup"
              value={setupName}
              onChangeText={setSetupName}
              placeholder="Setup name"
              hint="Pre-filled with the trade's current setup. A new name creates the setup, like web."
            />
            <ChipSelect
              label="Market condition"
              options={MARKET_CONDITION_OPTIONS}
              value={marketCondition}
              onChange={setMarketCondition}
              allowClear
            />
            <ChipSelect
              label="Trade reason"
              options={TRADE_REASON_OPTIONS}
              value={tradeReason}
              onChange={setTradeReason}
              allowClear
            />
            <ChipSelect
              label="Session"
              options={SESSION_OPTIONS}
              value={session}
              onChange={setSession}
              allowClear
            />
            <ChipSelect
              label="Confidence (1–5)"
              options={[1, 2, 3, 4, 5].map((n) => ({
                value: String(n),
                label: String(n),
              }))}
              value={confidence === null ? null : String(confidence)}
              onChange={(value) => setConfidence(value === null ? null : Number(value))}
              allowClear
            />
            <ChipSelect
              label="Emotion"
              options={EMOTION_OPTIONS}
              value={emotion}
              onChange={setEmotion}
              allowClear
            />
            <ChipSelect
              label="Discipline"
              options={DISCIPLINE_OPTIONS}
              value={discipline}
              onChange={setDiscipline}
              allowClear
            />
            <TextField
              label="Lesson learned"
              value={lesson}
              onChangeText={setLesson}
              placeholder="What did this trade teach you?"
              multiline
              maxLength={2000}
              hint="Adds a lesson to this trade (an identical lesson is not duplicated)."
            />
            <TextField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Journal notes"
              multiline
              maxLength={5000}
            />
            <SubmitBar
              label="Save review"
              onPress={handleSubmit}
              submitting={submitting}
              error={submitError}
            />
          </View>
        </GlassCard>
      )}
    </Screen>
  );
}
