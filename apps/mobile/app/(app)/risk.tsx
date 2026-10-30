import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Text, View } from "react-native";
import { saveRiskRules, saveTradingPlan } from "../../src/api";
import { useAuth } from "../../src/auth";
import {
  ErrorState,
  GlassCard,
  LoadingState,
  Screen,
} from "../../src/components";
import {
  ChipMultiSelect,
  FormSuccess,
  SubmitBar,
  TextField,
  parseNumberText,
  textOrNull,
} from "../../src/forms";
import { SESSION_OPTIONS } from "../../src/options";
import { supabase } from "../../src/supabase";
import { shared } from "../../src/theme";
import type {
  RiskRulesPayload,
  RiskRulesRow,
  SetupRow,
  TradingPlanPayload,
  TradingPlanRow,
  TradingSessionName,
} from "../../src/types";

/**
 * Risk rules + trading plan editors (Phase 25)
 * PUT /api/mobile/risk-rules and PUT /api/mobile/risk-plan.
 *
 * Both are FULL-FORM saves, pre-filled from the same RLS
 * reads the web uses (active risk_rules row / active
 * trading_plans row — apps/web/lib/risk/queries.ts). A blank
 * numeric field means "no limit set" and is sent as null,
 * exactly like the web forms. The app only displays and
 * submits values — risk evaluation happens server-side.
 */
export default function RiskScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setups, setSetups] = useState<SetupRow[]>([]);

  // Risk rules form state (text; blank = no limit).
  const [maxRiskPerTradePct, setMaxRiskPerTradePct] = useState("");
  const [maxDailyLoss, setMaxDailyLoss] = useState("");
  const [maxTradesPerDay, setMaxTradesPerDay] = useState("");
  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState("");
  const [maxLeverage, setMaxLeverage] = useState("");
  const [rulesSubmitting, setRulesSubmitting] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesSuccess, setRulesSuccess] = useState<string | null>(null);

  // Trading plan form state.
  const [planName, setPlanName] = useState("");
  const [planMarkets, setPlanMarkets] = useState("");
  const [planSessions, setPlanSessions] = useState<TradingSessionName[]>([]);
  const [planRiskPerTradePct, setPlanRiskPerTradePct] = useState("");
  const [planMaxDailyLoss, setPlanMaxDailyLoss] = useState("");
  const [planMaxDailyTrades, setPlanMaxDailyTrades] = useState("");
  const [planSetupIds, setPlanSetupIds] = useState<string[]>([]);
  const [planNoTradeConditions, setPlanNoTradeConditions] = useState("");
  const [planPsychologyRules, setPlanPsychologyRules] = useState("");
  const [planScheduleNotes, setPlanScheduleNotes] = useState("");
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const [rulesRes, planRes, setupsRes] = await Promise.all([
      supabase
        .from("risk_rules")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("trading_plans")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("setups").select("id, strategy_id, name").order("name"),
    ]);
    if (rulesRes.error) setError(rulesRes.error.message);
    else if (planRes.error) setError(planRes.error.message);
    else {
      const rules = (rulesRes.data as RiskRulesRow | null) ?? null;
      if (rules) {
        setMaxRiskPerTradePct(numText(rules.max_risk_per_trade_pct));
        setMaxDailyLoss(numText(rules.max_daily_loss));
        setMaxTradesPerDay(numText(rules.max_trades_per_day));
        setMaxConsecutiveLosses(numText(rules.max_consecutive_losses));
        setMaxLeverage(numText(rules.max_leverage));
      }
      const plan = (planRes.data as TradingPlanRow | null) ?? null;
      if (plan) {
        setPlanName(plan.name);
        setPlanMarkets((plan.markets ?? []).join(", "));
        setPlanSessions((plan.sessions ?? []) as TradingSessionName[]);
        setPlanRiskPerTradePct(numText(plan.risk_per_trade_pct));
        setPlanMaxDailyLoss(numText(plan.max_daily_loss));
        setPlanMaxDailyTrades(numText(plan.max_daily_trades));
        setPlanSetupIds(plan.preferred_setup_ids ?? []);
        setPlanNoTradeConditions(plan.no_trade_conditions ?? "");
        setPlanPsychologyRules(plan.psychology_rules ?? "");
        setPlanScheduleNotes(plan.schedule?.notes ?? "");
      }
      setSetups((setupsRes.data ?? []) as SetupRow[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Parse a numeric field for submit: blank → null, malformed → form error. */
  function numField(text: string, label: string): number | null {
    const value = parseNumberText(text);
    if (value !== null && Number.isNaN(value)) {
      throw new Error(`Enter a valid ${label}, or leave it blank for no limit.`);
    }
    return value;
  }

  async function handleRules() {
    if (rulesSubmitting) return;
    setRulesError(null);
    setRulesSuccess(null);
    let payload: RiskRulesPayload;
    try {
      payload = {
        maxRiskPerTradePct: numField(maxRiskPerTradePct, "max risk per trade"),
        maxDailyLoss: numField(maxDailyLoss, "max daily loss"),
        maxTradesPerDay: numField(maxTradesPerDay, "max trades per day"),
        maxConsecutiveLosses: numField(maxConsecutiveLosses, "max consecutive losses"),
        maxLeverage: numField(maxLeverage, "max leverage"),
      };
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Check the form and try again.");
      return;
    }
    setRulesSubmitting(true);
    try {
      await saveRiskRules(payload);
      setRulesSuccess("Risk rules saved.");
      await load();
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setRulesSubmitting(false);
    }
  }

  async function handlePlan() {
    if (planSubmitting) return;
    setPlanError(null);
    setPlanSuccess(null);
    if (planName.trim() === "") {
      setPlanError("Give the plan a name.");
      return;
    }
    let payload: TradingPlanPayload;
    try {
      payload = {
        name: planName.trim(),
        markets: planMarkets
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m !== ""),
        sessions: planSessions,
        riskPerTradePct: numField(planRiskPerTradePct, "risk per trade"),
        maxDailyLoss: numField(planMaxDailyLoss, "max daily loss"),
        maxDailyTrades: numField(planMaxDailyTrades, "max daily trades"),
        preferredSetupIds: planSetupIds,
        noTradeConditions: textOrNull(planNoTradeConditions),
        psychologyRules: textOrNull(planPsychologyRules),
        scheduleNotes: textOrNull(planScheduleNotes),
      };
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "Check the form and try again.");
      return;
    }
    setPlanSubmitting(true);
    try {
      await saveTradingPlan(payload);
      setPlanSuccess("Trading plan saved.");
      await load();
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setPlanSubmitting(false);
    }
  }

  return (
    <Screen>
      <Text style={shared.title}>Risk & plan</Text>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <GlassCard>
            <Text style={shared.heading}>Risk rules</Text>
            <Text style={shared.muted}>
              Leave a field blank for no limit. These rules are enforced by the server when
              trades are saved — the app never evaluates them.
            </Text>
            <View style={{ gap: 14 }}>
              <TextField label="Max risk per trade (%)" value={maxRiskPerTradePct} onChangeText={setMaxRiskPerTradePct} placeholder="No limit" keyboardType="decimal-pad" />
              <TextField label="Max daily loss" value={maxDailyLoss} onChangeText={setMaxDailyLoss} placeholder="No limit" keyboardType="decimal-pad" />
              <TextField label="Max trades per day" value={maxTradesPerDay} onChangeText={setMaxTradesPerDay} placeholder="No limit" keyboardType="number-pad" />
              <TextField label="Max consecutive losses" value={maxConsecutiveLosses} onChangeText={setMaxConsecutiveLosses} placeholder="No limit" keyboardType="number-pad" />
              <TextField label="Max leverage" value={maxLeverage} onChangeText={setMaxLeverage} placeholder="No limit" keyboardType="decimal-pad" />
              <FormSuccess message={rulesSuccess} />
              <SubmitBar label="Save risk rules" onPress={handleRules} submitting={rulesSubmitting} error={rulesError} />
            </View>
          </GlassCard>

          <GlassCard>
            <Text style={shared.heading}>Trading plan</Text>
            <View style={{ gap: 14 }}>
              <TextField label="Plan name" value={planName} onChangeText={setPlanName} placeholder="My trading plan" maxLength={120} />
              <TextField label="Markets" value={planMarkets} onChangeText={setPlanMarkets} placeholder="XAUUSD, EURUSD" hint="Comma-separated, up to 30." autoCapitalize="characters" />
              <ChipMultiSelect label="Sessions" options={SESSION_OPTIONS} values={planSessions} onChange={setPlanSessions} />
              <TextField label="Risk per trade (%)" value={planRiskPerTradePct} onChangeText={setPlanRiskPerTradePct} placeholder="No limit" keyboardType="decimal-pad" />
              <TextField label="Max daily loss" value={planMaxDailyLoss} onChangeText={setPlanMaxDailyLoss} placeholder="No limit" keyboardType="decimal-pad" />
              <TextField label="Max daily trades" value={planMaxDailyTrades} onChangeText={setPlanMaxDailyTrades} placeholder="No limit" keyboardType="number-pad" />
              {setups.length > 0 ? (
                <ChipMultiSelect
                  label="Preferred setups"
                  options={setups.map((s) => ({ value: s.id, label: s.name }))}
                  values={planSetupIds.filter((id) => setups.some((s) => s.id === id))}
                  onChange={setPlanSetupIds}
                />
              ) : null}
              <TextField label="No-trade conditions" value={planNoTradeConditions} onChangeText={setPlanNoTradeConditions} multiline maxLength={2000} />
              <TextField label="Psychology rules" value={planPsychologyRules} onChangeText={setPlanPsychologyRules} multiline maxLength={2000} />
              <TextField label="Schedule notes" value={planScheduleNotes} onChangeText={setPlanScheduleNotes} multiline maxLength={1000} />
              <FormSuccess message={planSuccess} />
              <SubmitBar label="Save trading plan" onPress={handlePlan} submitting={planSubmitting} error={planError} />
            </View>
          </GlassCard>
        </>
      )}
    </Screen>
  );
}

function numText(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}
