import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../src/auth";
import { supabase } from "../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GlassCard,
  LoadingState,
  PrimaryButton,
  Screen,
} from "../../src/components";
import { formatDate, formatNumber, titleCase } from "../../src/format";
import { shared, tokens } from "../../src/theme";
import type { GoalProgressRow, GoalRow } from "../../src/types";

/**
 * Goals — direct RLS reads of the caller's goals plus their
 * latest manually recorded progress rows. Goals whose progress
 * is measured from trading data are measured server-side in
 * the web app; here we show the stored progress honestly and
 * never invent a measured value.
 */
export default function GoalsScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [progress, setProgress] = useState<Map<string, GoalProgressRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    const [goalsRes, progressRes] = await Promise.all([
      supabase
        .from("goals")
        .select("*")
        .eq("user_id", session.user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("goal_progress")
        .select("goal_id, current_value, recorded_date, note")
        .eq("user_id", session.user.id)
        .order("recorded_date", { ascending: false }),
    ]);
    if (goalsRes.error) {
      setError(goalsRes.error.message);
    } else {
      setGoals((goalsRes.data ?? []) as GoalRow[]);
      const map = new Map<string, GoalProgressRow>();
      for (const row of (progressRes.data ?? []) as GoalProgressRow[]) {
        if (!map.has(row.goal_id)) map.set(row.goal_id, row);
      }
      setProgress(map);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) return <LoadingState label="Loading your goals…" />;

  return (
    <Screen>
      <Text style={shared.title}>Goals</Text>
      <PrimaryButton label="New goal" onPress={() => router.push("/(app)/goal/new")} />
      {error ? <ErrorState message={error} /> : null}
      {!error && goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          body="Set your first goal with New goal, then record progress from the goal's page."
        />
      ) : null}
      {goals.map((goal) => {
        const latest = progress.get(goal.id);
        const pct =
          latest && goal.target_value > 0
            ? Math.min(100, Math.max(0, (latest.current_value / goal.target_value) * 100))
            : null;
        return (
          <Pressable
            key={goal.id}
            accessibilityRole="button"
            onPress={() => router.push(`/(app)/goal/${goal.id}`)}
          >
          <GlassCard>
            <View style={shared.rowBetween}>
              <Text style={[shared.heading, { flex: 1, paddingRight: 8 }]}>{goal.title}</Text>
              <Text
                style={{
                  color: goal.status === "completed" ? tokens.profit : tokens.textMuted,
                  fontSize: 12,
                  fontWeight: "700",
                  textTransform: "uppercase",
                }}
              >
                {goal.status}
              </Text>
            </View>
            <Text style={shared.muted}>
              {titleCase(goal.period)} · {titleCase(goal.goal_type)} · Target{" "}
              {formatNumber(goal.target_value, goal.target_value % 1 === 0 ? 0 : 2)}
              {goal.target_unit ? ` ${goal.target_unit}` : ""} · {formatDate(goal.start_date)}
              {goal.end_date ? ` → ${formatDate(goal.end_date)}` : ""}
            </Text>
            {latest ? (
              <>
                <View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: tokens.glassElevated,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 8,
                      width: `${pct ?? 0}%`,
                      backgroundColor: tokens.blueBright,
                    }}
                  />
                </View>
                <Text style={shared.muted}>
                  Recorded progress: {formatNumber(latest.current_value, 2)} of{" "}
                  {formatNumber(goal.target_value, 2)}
                  {goal.target_unit ? ` ${goal.target_unit}` : ""} ·{" "}
                  {formatDate(latest.recorded_date)}
                  {latest.note ? ` · ${latest.note}` : ""}
                </Text>
              </>
            ) : (
              <Text style={shared.muted}>
                No recorded progress yet — tap to record progress.
              </Text>
            )}
          </GlassCard>
          </Pressable>
        );
      })}
    </Screen>
  );
}
