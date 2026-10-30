import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { recordGoalProgress, updateGoalStatus } from "../../../src/api";
import {
  EmptyState,
  ErrorState,
  GlassCard,
  LoadingState,
  Screen,
  Stat,
} from "../../../src/components";
import { formatDate, formatNumber, titleCase } from "../../../src/format";
import {
  ChipSelect,
  FormSuccess,
  SubmitBar,
  TextField,
  isValidNumberText,
  parseNumberText,
  textOrNull,
} from "../../../src/forms";
import { GOAL_STATUS_OPTIONS } from "../../../src/options";
import { supabase } from "../../../src/supabase";
import { shared } from "../../../src/theme";
import type { GoalProgressRow, GoalRow } from "../../../src/types";

/**
 * Goal detail (Phase 25): record progress
 * (POST /api/mobile/goals/[id]/progress) and change status
 * (PATCH /api/mobile/goals/[id] — { status } is the only
 * edit the API exposes; there is no endpoint to edit a
 * goal's title/target/dates, see docs/phase-25.md gaps).
 * Current values shown are the stored goal_progress rows —
 * the app computes nothing.
 */
export default function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [goal, setGoal] = useState<GoalRow | null>(null);
  const [progress, setProgress] = useState<GoalProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentValue, setCurrentValue] = useState("");
  const [note, setNote] = useState("");
  const [progressSubmitting, setProgressSubmitting] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressSuccess, setProgressSuccess] = useState<string | null>(null);

  const [status, setStatus] = useState<GoalRow["status"]>("active");
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [goalRes, progressRes] = await Promise.all([
      supabase.from("goals").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("goal_progress")
        .select("goal_id, current_value, recorded_date, note")
        .eq("goal_id", id)
        .order("recorded_date", { ascending: false }),
    ]);
    if (goalRes.error) setError(goalRes.error.message);
    else {
      const loaded = (goalRes.data as GoalRow | null) ?? null;
      setGoal(loaded);
      if (loaded) setStatus(loaded.status);
    }
    if (!progressRes.error) setProgress((progressRes.data ?? []) as GoalProgressRow[]);
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

  async function handleProgress() {
    if (!goal || progressSubmitting) return;
    if (!isValidNumberText(currentValue))
      return setProgressError("Enter the current value.");
    setProgressError(null);
    setProgressSuccess(null);
    setProgressSubmitting(true);
    try {
      const result = await recordGoalProgress(goal.id, {
        currentValue: parseNumberText(currentValue) as number,
        note: textOrNull(note),
      });
      setProgressSuccess(
        `Progress saved — the server recorded ${formatNumber(result.current_value)} for today.`,
      );
      setCurrentValue("");
      setNote("");
      await load();
    } catch (e) {
      setProgressError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setProgressSubmitting(false);
    }
  }

  async function handleStatus() {
    if (!goal || statusSubmitting || status === goal.status) return;
    setStatusError(null);
    setStatusSuccess(null);
    setStatusSubmitting(true);
    try {
      const result = await updateGoalStatus(goal.id, status);
      setStatusSuccess(`Status saved — this goal is now ${result.status}.`);
      await load();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setStatusSubmitting(false);
    }
  }

  const latest = progress[0] ?? null;

  return (
    <Screen>
      <Text style={shared.title}>Goal</Text>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : !goal ? (
        <EmptyState title="Goal not found" body="This goal could not be loaded." />
      ) : (
        <>
          <GlassCard hero>
            <Text style={shared.heading}>{goal.title}</Text>
            <Text style={shared.muted}>
              {titleCase(goal.period)} · {titleCase(goal.goal_type)} · {titleCase(goal.status)}
            </Text>
            <View style={shared.rowBetween}>
              <Stat
                label="Latest value"
                value={latest ? formatNumber(latest.current_value) : "—"}
              />
              <Stat
                label="Target"
                value={`${formatNumber(goal.target_value)}${goal.target_unit ? ` ${goal.target_unit}` : ""}`}
              />
            </View>
            <Text style={shared.muted}>
              {formatDate(goal.start_date)}
              {goal.end_date ? ` → ${formatDate(goal.end_date)}` : ""}
            </Text>
          </GlassCard>

          <GlassCard>
            <Text style={shared.heading}>Record progress</Text>
            <View style={{ gap: 14 }}>
              <TextField
                label="Current value"
                value={currentValue}
                onChangeText={setCurrentValue}
                placeholder={latest ? formatNumber(latest.current_value) : "0"}
                keyboardType="decimal-pad"
                hint="Today's total for this goal — the server stores one value per day."
              />
              <TextField label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} />
              <FormSuccess message={progressSuccess} />
              <SubmitBar
                label="Save progress"
                onPress={handleProgress}
                submitting={progressSubmitting}
                error={progressError}
              />
            </View>
          </GlassCard>

          <GlassCard>
            <Text style={shared.heading}>Status</Text>
            <View style={{ gap: 14 }}>
              <ChipSelect
                label="Goal status"
                options={GOAL_STATUS_OPTIONS}
                value={status}
                onChange={(v) => v && setStatus(v)}
                hint="Marking a goal completed awards its XP on the server. Title, target and dates cannot be edited after creation — the API exposes status changes only."
              />
              <FormSuccess message={statusSuccess} />
              <SubmitBar
                label="Save status"
                onPress={handleStatus}
                submitting={statusSubmitting}
                error={statusError}
                disabled={status === goal.status}
              />
            </View>
          </GlassCard>

          <GlassCard>
            <Text style={shared.heading}>Progress history</Text>
            {progress.length === 0 ? (
              <Text style={shared.muted}>No progress recorded yet.</Text>
            ) : (
              progress.map((row) => (
                <View key={row.recorded_date} style={shared.rowBetween}>
                  <Text style={shared.body}>{formatDate(row.recorded_date)}</Text>
                  <Text style={shared.body}>{formatNumber(row.current_value)}</Text>
                </View>
              ))
            )}
          </GlassCard>
        </>
      )}
    </Screen>
  );
}
