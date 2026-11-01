import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { calcPnl, calcRiskAmount, calcRiskReward, calcRMultiple, calcRoi } from "@itg/calc";
import { editTrade } from "../../../../src/api";
import {
  EmptyState,
  ErrorState,
  GhostButton,
  GlassCard,
  LoadingState,
  PrimaryButton,
  Screen,
} from "../../../../src/components";
import {
  ChipSelect,
  DateTimeField,
  Field,
  FormError,
  SubmitBar,
  TextField,
  isoToParts,
  isValidNumberText,
  parseNumberText,
  partsToIso,
  textOrNull,
} from "../../../../src/forms";
import { formatMoney, formatNumber } from "../../../../src/format";
import {
  DISCIPLINE_OPTIONS,
  EMOTION_OPTIONS,
  MARKET_CONDITION_OPTIONS,
  SESSION_OPTIONS,
  TRADE_REASON_OPTIONS,
} from "../../../../src/options";
import { supabase } from "../../../../src/supabase";
import { shared, tokens } from "../../../../src/theme";
import type {
  AdvancedReviewPayload,
  Direction,
  DisciplineName,
  EditTradeResponse,
  EmotionName,
  LessonRow,
  MarketCondition,
  PsychologyRow,
  QuickTradePayload,
  SetupRow,
  StrategyRow,
  TradeReason,
  TradeRow,
  TradingSessionName,
} from "../../../../src/types";

/**
 * Edit Trade — POST /api/mobile/trades/[id]/edit.
 *
 * ONE full-form save (financial fields + journal fields),
 * pre-filled from the RLS reads — the same full-form rule as
 * the Review screen: the endpoint overwrites the journal
 * with what is sent, so every field round-trips its stored
 * value (strategyId and the setup NAME included).
 *
 * The endpoint orchestrates the edit (editTradeCore, shared
 * with web): a financial change corrects by reversal, a
 * journal-only change saves in place, no change writes
 * nothing. This screen only mirrors that split for the
 * confirmation step: when a financial field changed, the
 * trader first sees the changed fields old → new and the
 * recalculated P&L / R / ROI (computed with the vendored
 * @itg/calc primitives — the same math the server runs) and
 * confirms before anything is sent. Derived values are
 * never editable inputs, here or anywhere.
 *
 * The financial fields are composed from the same
 * src/forms.tsx controls the shared QuickTradeForm uses —
 * that component owns its own submit bar, which cannot host
 * this screen's cross-section confirm gate, so the fields
 * are laid out here directly with identical payload shape.
 */
export default function EditTradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [trade, setTrade] = useState<TradeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Financial state (raw text, like the quick form). */
  const [pair, setPair] = useState("");
  const [direction, setDirection] = useState<Direction>("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [positionSize, setPositionSize] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [fees, setFees] = useState("");
  const [openedDate, setOpenedDate] = useState("");
  const [openedTime, setOpenedTime] = useState("");
  const [closedDate, setClosedDate] = useState("");
  const [closedTime, setClosedTime] = useState("");

  /* Journal state (full-form, round-tripped). */
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
  const [confirm, setConfirm] = useState<{
    rows: { label: string; from: string; to: string }[];
    metrics: { label: string; from: string; to: string }[];
    correction: QuickTradePayload;
    review: AdvancedReviewPayload;
  } | null>(null);
  const [done, setDone] = useState<EditTradeResponse | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [tradeRes, psychRes, setupsRes, strategiesRes, lessonsRes] =
      await Promise.all([
        supabase.from("trades").select("*").eq("id", id).maybeSingle(),
        supabase.from("psychology_records").select("*").eq("trade_id", id).maybeSingle(),
        supabase.from("setups").select("id, strategy_id, name"),
        supabase.from("strategies").select("id, name, description, is_system").order("name"),
        supabase
          .from("lessons")
          .select("*")
          .eq("trade_id", id)
          .order("created_at", { ascending: true }),
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
      const lessons = (lessonsRes.data ?? []) as LessonRow[];
      setStrategies((strategiesRes.data ?? []) as StrategyRow[]);
      // Financial pre-fill, exactly as stored.
      setPair(loaded.pair);
      setDirection(loaded.direction);
      setEntryPrice(numText(loaded.entry_price));
      setExitPrice(numText(loaded.exit_price));
      setTp(numText(loaded.tp));
      setSl(numText(loaded.sl));
      setPositionSize(numText(loaded.position_size));
      setLeverage(numText(loaded.leverage) || "1");
      setFees(numText(loaded.fees));
      const opened = isoToParts(loaded.opened_at);
      setOpenedDate(opened.date);
      setOpenedTime(opened.time);
      const closed = loaded.closed_at
        ? isoToParts(loaded.closed_at)
        : { date: "", time: "" };
      setClosedDate(closed.date);
      setClosedTime(closed.time);
      // Journal round-trip (the Review screen's rule).
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
      setLesson(lessons[lessons.length - 1]?.text ?? "");
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

  const hasExit = exitPrice.trim() !== "";

  function buildPayloads(): { correction: QuickTradePayload; review: AdvancedReviewPayload } | null {
    // Presence/format checks only — the server schema is
    // authoritative and its messages replace these on a 4xx.
    if (pair.trim() === "") {
      setSubmitError("Enter the pair (e.g. XAUUSD).");
      return null;
    }
    if (!isValidNumberText(entryPrice)) {
      setSubmitError("Enter the entry price.");
      return null;
    }
    if (!isValidNumberText(positionSize)) {
      setSubmitError("Enter the position size.");
      return null;
    }
    if (!isValidNumberText(leverage)) {
      setSubmitError("Enter the leverage.");
      return null;
    }
    if (hasExit && !isValidNumberText(exitPrice)) {
      setSubmitError("Enter a valid exit price, or leave it blank for an open trade.");
      return null;
    }
    for (const [text, label] of [
      [tp, "take profit"],
      [sl, "stop loss"],
      [fees, "fees"],
    ] as const) {
      if (text.trim() !== "" && !isValidNumberText(text)) {
        setSubmitError(`Enter a valid ${label}, or leave it blank.`);
        return null;
      }
    }
    const openedAt = partsToIso(openedDate, openedTime);
    if (!openedAt) {
      setSubmitError("Enter the open date and time (YYYY-MM-DD, HH:MM).");
      return null;
    }
    let closedAt: string | null = null;
    if (hasExit) {
      closedAt = partsToIso(closedDate, closedTime);
      if (!closedAt) {
        setSubmitError("Enter the close date and time (YYYY-MM-DD, HH:MM).");
        return null;
      }
    }
    const correction: QuickTradePayload = {
      pair: pair.trim(),
      direction,
      entryPrice: parseNumberText(entryPrice) as number,
      exitPrice: parseNumberText(exitPrice),
      tp: parseNumberText(tp),
      sl: parseNumberText(sl),
      positionSize: parseNumberText(positionSize) as number,
      strategyId,
      leverage: parseNumberText(leverage) as number,
      fees: parseNumberText(fees),
      openedAt,
      closedAt,
    };
    const review: AdvancedReviewPayload = {
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
    return { correction, review };
  }

  /** The changed financial fields, old → new — the same comparisons the core makes. */
  function financialDiff(correction: QuickTradePayload) {
    if (!trade) return { changed: false, rows: [] as { label: string; from: string; to: string }[] };
    const rows: { label: string; from: string; to: string }[] = [];
    const numRow = (label: string, from: number | null, to: number | null) => {
      const a = from === null || from === undefined ? null : Number(from);
      const b = to === null || to === undefined ? null : Number(to);
      if (a !== b) rows.push({ label, from: a === null ? "—" : String(a), to: b === null ? "—" : String(b) });
    };
    const normalizedPair = correction.pair.toUpperCase().replace(/\s+/g, "");
    if (normalizedPair !== trade.pair) {
      rows.push({ label: "Pair", from: trade.pair, to: normalizedPair });
    }
    if (correction.direction !== trade.direction) {
      rows.push({ label: "Direction", from: trade.direction, to: correction.direction });
    }
    numRow("Entry price", trade.entry_price, correction.entryPrice);
    numRow("Exit price", trade.exit_price, correction.exitPrice);
    numRow("Take profit", trade.tp, correction.tp);
    numRow("Stop loss", trade.sl, correction.sl);
    numRow("Position size", trade.position_size, correction.positionSize);
    numRow("Leverage", trade.leverage, correction.leverage);
    if ((correction.fees ?? 0) !== Number(trade.fees ?? 0)) {
      rows.push({ label: "Fees", from: String(trade.fees ?? 0), to: String(correction.fees ?? 0) });
    }
    const timeRow = (label: string, from: string | null, to: string | null) => {
      const changed =
        from === null || to === null
          ? from !== to
          : Date.parse(from) !== Date.parse(to);
      if (changed) {
        rows.push({
          label,
          from: from === null ? "—" : new Date(from).toLocaleString(),
          to: to === null ? "—" : new Date(to).toLocaleString(),
        });
      }
    };
    timeRow("Opened", trade.opened_at, correction.openedAt);
    timeRow("Closed", trade.closed_at, correction.closedAt);
    return { changed: rows.length > 0, rows };
  }

  /** Recalculated outcome for the confirmation — @itg/calc, the server's own math. */
  function newMetrics(correction: QuickTradePayload) {
    if (!trade) return [];
    const closed = correction.exitPrice !== null && correction.closedAt !== null;
    const pnl = closed
      ? calcPnl({
          direction: correction.direction,
          entryPrice: correction.entryPrice,
          exitPrice: correction.exitPrice as number,
          positionSize: correction.positionSize,
          fees: correction.fees ?? 0,
        })
      : null;
    const riskAmount = calcRiskAmount({
      entryPrice: correction.entryPrice,
      stopLoss: correction.sl,
      positionSize: correction.positionSize,
    });
    const fmt = (v: number | null, suffix = "") =>
      v === null ? "—" : `${formatNumber(v)}${suffix}`;
    return [
      { label: "P&L", from: formatMoney(trade.pnl), to: formatMoney(pnl) },
      {
        label: "R multiple",
        from: fmt(trade.r_multiple, "R"),
        to: fmt(pnl === null ? null : calcRMultiple({ pnl, riskAmount }), "R"),
      },
      {
        label: "ROI",
        from: trade.roi_pct === null ? "—" : `${formatNumber(trade.roi_pct)}%`,
        to:
          pnl === null
            ? "—"
            : `${formatNumber(
                calcRoi({
                  pnl,
                  entryPrice: correction.entryPrice,
                  positionSize: correction.positionSize,
                  leverage: correction.leverage,
                }),
              )}%`,
      },
      {
        label: "Risk / reward",
        from: trade.risk_reward === null ? "—" : `1 : ${formatNumber(trade.risk_reward)}`,
        to: (() => {
          const rr = calcRiskReward({
            direction: correction.direction,
            entryPrice: correction.entryPrice,
            stopLoss: correction.sl,
            takeProfit: correction.tp,
          });
          return rr === null ? "—" : `1 : ${formatNumber(rr)}`;
        })(),
      },
    ];
  }

  async function send(correction: QuickTradePayload, review: AdvancedReviewPayload) {
    if (!trade || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await editTrade(trade.id, { correction, review });
      setConfirm(null);
      setDone(result);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    if (!trade || submitting) return;
    setSubmitError(null);
    const payloads = buildPayloads();
    if (!payloads) return;
    const diff = financialDiff(payloads.correction);
    if (diff.changed) {
      // Financial change: confirm first (values stay in the
      // form — nothing is sent until Confirm is tapped).
      setConfirm({
        rows: diff.rows,
        metrics: newMetrics(payloads.correction),
        correction: payloads.correction,
        review: payloads.review,
      });
      return;
    }
    void send(payloads.correction, payloads.review);
  }

  const editable = trade !== null && (trade.status === "open" || trade.status === "closed");

  if (done && trade) {
    return (
      <Screen>
        <Text style={shared.title}>Edit trade</Text>
        <GlassCard>
          <Text style={shared.heading}>Trade updated</Text>
          <Text style={shared.body}>
            {done.changed_fields.length === 0
              ? "No changes to save — the trade already matches what you entered."
              : done.financial_changed
                ? "Your financial edit was saved as a corrected trade, and the original was marked reversed — the audit trail keeps both. Your journal, psychology and lesson were carried onto the corrected trade."
                : "Your journal changes were saved to this trade."}
          </Text>
          <PrimaryButton
            label="View trade"
            onPress={() => router.replace(`/(app)/trade/${done.trade_id}`)}
          />
        </GlassCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={shared.title}>Edit trade</Text>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : !trade ? (
        <EmptyState title="Trade not found" body="This trade could not be loaded." />
      ) : !editable ? (
        <EmptyState
          title="This trade cannot be edited"
          body={
            trade.status === "reversed"
              ? "This trade was corrected by a reversal — edit the correcting trade instead."
              : "A cancelled trade can no longer be edited."
          }
        />
      ) : (
        <>
          <GlassCard>
            <View style={{ gap: 14 }}>
              <Text style={shared.body}>
                Editing {trade.pair}. Financial changes correct the trade by reversal — a
                corrected trade is created and this one is marked reversed, so the audit
                trail stays intact. Journal changes save in place. P&amp;L, R and ROI are
                always recalculated by the server — never entered.
              </Text>
              <TextField
                label="Pair"
                value={pair}
                onChangeText={setPair}
                placeholder="XAUUSD"
                autoCapitalize="characters"
              />
              <Field label="Direction">
                <View style={styles.directionRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDirection("long")}
                    style={[styles.directionChip, direction === "long" && styles.directionLong]}
                  >
                    <Text style={[styles.directionText, direction === "long" && { color: tokens.profit }]}>
                      Long
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDirection("short")}
                    style={[styles.directionChip, direction === "short" && styles.directionShort]}
                  >
                    <Text style={[styles.directionText, direction === "short" && { color: tokens.loss }]}>
                      Short
                    </Text>
                  </Pressable>
                </View>
              </Field>
              <TextField label="Entry price" value={entryPrice} onChangeText={setEntryPrice} placeholder="0.00" keyboardType="decimal-pad" />
              <TextField label="Exit price (blank = still open)" value={exitPrice} onChangeText={setExitPrice} placeholder="0.00" keyboardType="decimal-pad" />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <TextField label="Stop loss" value={sl} onChangeText={setSl} placeholder="Optional" keyboardType="decimal-pad" />
                </View>
                <View style={styles.flex}>
                  <TextField label="Take profit" value={tp} onChangeText={setTp} placeholder="Optional" keyboardType="decimal-pad" />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <TextField label="Position size" value={positionSize} onChangeText={setPositionSize} placeholder="0.00" keyboardType="decimal-pad" />
                </View>
                <View style={styles.flex}>
                  <TextField label="Leverage" value={leverage} onChangeText={setLeverage} placeholder="1" keyboardType="number-pad" />
                </View>
              </View>
              <TextField label="Fees (optional)" value={fees} onChangeText={setFees} placeholder="0.00" keyboardType="decimal-pad" />
              <DateTimeField label="Opened at" date={openedDate} time={openedTime} onChangeDate={setOpenedDate} onChangeTime={setOpenedTime} />
              {hasExit ? (
                <DateTimeField label="Closed at" date={closedDate} time={closedTime} onChangeDate={setClosedDate} onChangeTime={setClosedTime} />
              ) : null}
            </View>
          </GlassCard>

          <GlassCard>
            <View style={{ gap: 14 }}>
              <Text style={shared.heading}>Journal &amp; review</Text>
              <ChipSelect
                label="Strategy"
                options={[
                  { value: "", label: "No strategy" },
                  ...strategies.map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={strategyId ?? ""}
                onChange={(value) => setStrategyId(value === "" || value === null ? null : value)}
              />
              <TextField
                label="Setup"
                value={setupName}
                onChangeText={setSetupName}
                placeholder="Setup name"
                hint="Pre-filled with the trade's current setup. A new name creates the setup, like web."
              />
              <ChipSelect label="Market condition" options={MARKET_CONDITION_OPTIONS} value={marketCondition} onChange={setMarketCondition} allowClear />
              <ChipSelect label="Trade reason" options={TRADE_REASON_OPTIONS} value={tradeReason} onChange={setTradeReason} allowClear />
              <ChipSelect label="Session" options={SESSION_OPTIONS} value={session} onChange={setSession} allowClear />
              <ChipSelect
                label="Confidence (1–5)"
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
                value={confidence === null ? null : String(confidence)}
                onChange={(value) => setConfidence(value === null ? null : Number(value))}
                allowClear
              />
              <ChipSelect label="Emotion" options={EMOTION_OPTIONS} value={emotion} onChange={setEmotion} allowClear />
              <ChipSelect label="Discipline" options={DISCIPLINE_OPTIONS} value={discipline} onChange={setDiscipline} allowClear />
              <TextField
                label="Lesson learned"
                value={lesson}
                onChangeText={setLesson}
                placeholder="What did this trade teach you?"
                multiline
                maxLength={2000}
                hint="Pre-filled with the trade's latest lesson (an identical lesson is not duplicated)."
              />
              <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Journal notes" multiline maxLength={5000} />
            </View>
          </GlassCard>

          {confirm ? (
            <GlassCard hero>
              <Text style={shared.heading}>Review the financial changes</Text>
              <Text style={shared.body}>
                This change will recalculate the trade&apos;s P&amp;L, R-multiple and related
                analytics. Saving creates a corrected trade and marks this one as reversed —
                the original stays in the audit trail.
              </Text>
              {confirm.rows.map((row) => (
                <View key={row.label} style={shared.rowBetween}>
                  <Text style={shared.muted}>{row.label}</Text>
                  <Text style={{ color: tokens.textPrimary, fontSize: 14, fontVariant: ["tabular-nums"] }}>
                    {row.from} → {row.to}
                  </Text>
                </View>
              ))}
              {confirm.metrics.map((row) => (
                <View key={row.label} style={shared.rowBetween}>
                  <Text style={shared.muted}>{row.label}</Text>
                  <Text style={{ color: tokens.textPrimary, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
                    {row.from} → {row.to}
                  </Text>
                </View>
              ))}
              <FormError message={submitError} />
              <PrimaryButton
                label="Confirm changes"
                onPress={() => void send(confirm.correction, confirm.review)}
                loading={submitting}
              />
              <GhostButton label="Cancel" onPress={() => setConfirm(null)} />
            </GlassCard>
          ) : (
            <SubmitBar label="Save changes" onPress={handleSubmit} submitting={submitting} error={submitError} />
          )}
        </>
      )}
    </Screen>
  );
}

function numText(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  directionRow: {
    flexDirection: "row",
    gap: 10,
  },
  directionChip: {
    flex: 1,
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusSm,
    backgroundColor: tokens.glass,
    paddingVertical: 12,
    alignItems: "center",
  },
  directionLong: {
    borderColor: tokens.profit,
    backgroundColor: "rgba(33, 243, 165, 0.13)",
  },
  directionShort: {
    borderColor: tokens.loss,
    backgroundColor: "rgba(255, 77, 114, 0.13)",
  },
  directionText: {
    color: tokens.textSecondary,
    fontSize: 15,
    fontWeight: "700",
  },
});
