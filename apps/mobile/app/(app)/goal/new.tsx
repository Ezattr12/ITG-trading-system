import { useState } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { createGoal } from "../../../src/api";
import { GlassCard, Screen } from "../../../src/components";
import {
  ChipSelect,
  SubmitBar,
  TextField,
  isDateText,
  isValidNumberText,
  parseNumberText,
  textOrNull,
  toDateText,
} from "../../../src/forms";
import { GOAL_PERIOD_OPTIONS, GOAL_TYPE_OPTIONS } from "../../../src/options";
import { shared } from "../../../src/theme";
import type { GoalRow } from "../../../src/types";

/**
 * Create Goal (Phase 25) — POST /api/mobile/goals.
 * Body is exactly goalSchema's fields; dates are YYYY-MM-DD.
 */
export default function NewGoalScreen() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState<GoalRow["period"]>("weekly");
  const [goalType, setGoalType] = useState<string>("journal_completion");
  const [targetValue, setTargetValue] = useState("");
  const [targetUnit, setTargetUnit] = useState("");
  const [startDate, setStartDate] = useState(toDateText(new Date()));
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (submitting) return;
    if (title.trim() === "") return setError("Give the goal a title.");
    if (!isValidNumberText(targetValue)) return setError("Enter the target value.");
    if (!isDateText(startDate)) return setError("Enter a valid start date (YYYY-MM-DD).");
    if (endDate.trim() !== "" && !isDateText(endDate.trim()))
      return setError("Enter a valid end date (YYYY-MM-DD), or leave it blank.");
    setError(null);
    setSubmitting(true);
    try {
      const result = await createGoal({
        title: title.trim(),
        period,
        goalType,
        targetValue: parseNumberText(targetValue) as number,
        targetUnit: textOrNull(targetUnit),
        startDate,
        endDate: textOrNull(endDate),
      });
      router.replace(`/(app)/goal/${result.goal.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <Text style={shared.title}>New goal</Text>
      <GlassCard>
        <View style={{ gap: 14 }}>
          <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Journal every trade this week" maxLength={120} />
          <ChipSelect label="Period" options={GOAL_PERIOD_OPTIONS} value={period} onChange={(v) => v && setPeriod(v)} />
          <ChipSelect label="Type" options={GOAL_TYPE_OPTIONS} value={goalType} onChange={(v) => v && setGoalType(v)} />
          <TextField label="Target value" value={targetValue} onChangeText={setTargetValue} placeholder="0" keyboardType="decimal-pad" />
          <TextField label="Target unit (optional)" value={targetUnit} onChangeText={setTargetUnit} placeholder="trades, hours, %" maxLength={40} />
          <TextField label="Start date" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" keyboardType="number-pad" autoCapitalize="none" />
          <TextField label="End date (optional)" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" keyboardType="number-pad" autoCapitalize="none" />
          <SubmitBar label="Create goal" onPress={handleSubmit} submitting={submitting} error={error} />
        </View>
      </GlassCard>
    </Screen>
  );
}
