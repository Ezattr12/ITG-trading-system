import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ChipSelect,
  DateTimeField,
  Field,
  SubmitBar,
  TextField,
  isoToParts,
  isValidNumberText,
  nowParts,
  parseNumberText,
  partsToIso,
} from "./forms";
import { supabase } from "./supabase";
import { tokens } from "./theme";
import type { Direction, QuickTradePayload, StrategyRow, TradeRow } from "./types";

/**
 * Quick-trade form — shared by Add Trade, Close Trade and
 * Correct Trade, mirroring the web QuickTradeForm: one form,
 * three submit targets (create / correct). The payload is
 * EXACTLY quickTradeSchema's field set: raw inputs only.
 * P&L, R multiple, ROI and status are computed by the server
 * core (computeTradeMetrics) — the app never computes or
 * sends them. Note there is deliberately NO session field:
 * quickTradeSchema does not accept one (an unknown key is a
 * 400) — session is set by the advanced review.
 *
 * `onSubmit` throws with the server's message on failure;
 * the form shows it verbatim.
 */
export function QuickTradeForm({
  initial = null,
  submitLabel,
  requireExit = false,
  onSubmit,
}: {
  initial?: TradeRow | null;
  submitLabel: string;
  /** Close mode: an exit price + close time are required (presence check only). */
  requireExit?: boolean;
  onSubmit: (payload: QuickTradePayload) => Promise<void>;
}) {
  const [pair, setPair] = useState(initial?.pair ?? "");
  const [direction, setDirection] = useState<Direction>(initial?.direction ?? "long");
  const [entryPrice, setEntryPrice] = useState(numText(initial?.entry_price));
  const [exitPrice, setExitPrice] = useState(numText(initial?.exit_price));
  const [tp, setTp] = useState(numText(initial?.tp));
  const [sl, setSl] = useState(numText(initial?.sl));
  const [positionSize, setPositionSize] = useState(numText(initial?.position_size));
  const [leverage, setLeverage] = useState(numText(initial?.leverage) || "1");
  const [fees, setFees] = useState(numText(initial?.fees));
  const [strategyId, setStrategyId] = useState<string | null>(initial?.strategy_id ?? null);
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);

  const openedInit = initial?.opened_at ? isoToParts(initial.opened_at) : nowParts();
  const [openedDate, setOpenedDate] = useState(openedInit.date);
  const [openedTime, setOpenedTime] = useState(openedInit.time);
  const closedInit = initial?.closed_at
    ? isoToParts(initial.closed_at)
    : requireExit
      ? nowParts()
      : { date: "", time: "" };
  const [closedDate, setClosedDate] = useState(closedInit.date);
  const [closedTime, setClosedTime] = useState(closedInit.time);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("strategies")
      .select("id, name, description, is_system")
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setStrategies((data ?? []) as StrategyRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasExit = exitPrice.trim() !== "";

  async function handleSubmit() {
    if (submitting) return;
    // Presence/format checks only — the server schema is
    // authoritative and its messages replace these on a 422.
    if (pair.trim() === "") return setError("Enter the pair (e.g. XAUUSD).");
    if (!isValidNumberText(entryPrice)) return setError("Enter the entry price.");
    if (!isValidNumberText(positionSize)) return setError("Enter the position size.");
    if (!isValidNumberText(leverage)) return setError("Enter the leverage.");
    if (hasExit && !isValidNumberText(exitPrice))
      return setError("Enter a valid exit price, or leave it blank for an open trade.");
    if (requireExit && !hasExit) return setError("Enter the exit price to close this trade.");
    for (const [text, label] of [
      [tp, "take profit"],
      [sl, "stop loss"],
      [fees, "fees"],
    ] as const) {
      if (text.trim() !== "" && !isValidNumberText(text))
        return setError(`Enter a valid ${label}, or leave it blank.`);
    }
    const openedAt = partsToIso(openedDate, openedTime);
    if (!openedAt) return setError("Enter the open date and time (YYYY-MM-DD, HH:MM).");
    let closedAt: string | null = null;
    if (hasExit) {
      closedAt = partsToIso(closedDate, closedTime);
      if (!closedAt)
        return setError("Enter the close date and time (YYYY-MM-DD, HH:MM).");
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
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
      });
      // Success: the parent navigates away; stay in the
      // submitting state so the button cannot be re-tapped.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
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
            style={[
              styles.directionChip,
              direction === "long" && styles.directionLong,
            ]}
          >
            <Text
              style={[
                styles.directionText,
                direction === "long" && { color: tokens.profit },
              ]}
            >
              Long
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDirection("short")}
            style={[
              styles.directionChip,
              direction === "short" && styles.directionShort,
            ]}
          >
            <Text
              style={[
                styles.directionText,
                direction === "short" && { color: tokens.loss },
              ]}
            >
              Short
            </Text>
          </Pressable>
        </View>
      </Field>
      <TextField
        label="Entry price"
        value={entryPrice}
        onChangeText={setEntryPrice}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <TextField
        label={requireExit ? "Exit price" : "Exit price (blank = still open)"}
        value={exitPrice}
        onChangeText={setExitPrice}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label="Stop loss"
            value={sl}
            onChangeText={setSl}
            placeholder="Optional"
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Take profit"
            value={tp}
            onChangeText={setTp}
            placeholder="Optional"
            keyboardType="decimal-pad"
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label="Position size"
            value={positionSize}
            onChangeText={setPositionSize}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Leverage"
            value={leverage}
            onChangeText={setLeverage}
            placeholder="1"
            keyboardType="number-pad"
          />
        </View>
      </View>
      <TextField
        label="Fees (optional)"
        value={fees}
        onChangeText={setFees}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <ChipSelect
        label="Strategy (optional)"
        options={[
          { value: "", label: "No strategy" },
          ...strategies.map((s) => ({ value: s.id, label: s.name })),
        ]}
        value={strategyId ?? ""}
        onChange={(value) => setStrategyId(value === "" || value === null ? null : value)}
      />
      <DateTimeField
        label="Opened at"
        date={openedDate}
        time={openedTime}
        onChangeDate={setOpenedDate}
        onChangeTime={setOpenedTime}
      />
      {hasExit || requireExit ? (
        <DateTimeField
          label="Closed at"
          date={closedDate}
          time={closedTime}
          onChangeDate={setClosedDate}
          onChangeTime={setClosedTime}
        />
      ) : null}
      <SubmitBar
        label={submitLabel}
        onPress={handleSubmit}
        submitting={submitting}
        error={error}
      />
    </View>
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
