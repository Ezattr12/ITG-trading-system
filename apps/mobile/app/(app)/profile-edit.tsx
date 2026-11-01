import { useCallback, useEffect, useState } from "react";
import { Image, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { updateProfile } from "../../src/api";
import { useAuth } from "../../src/auth";
import { calcProfileCompletion } from "@itg/calc/src/profile-completion";
import {
  ErrorState,
  GradientCard,
  LoadingState,
  Screen,
} from "../../src/components";
import {
  ChipSelect,
  Field,
  SubmitBar,
  TextField,
  isDateText,
  isValidNumberText,
  parseNumberText,
  textOrNull,
} from "../../src/forms";
import { EMPLOYMENT_STATUS_OPTIONS } from "../../src/options";
import { supabase } from "../../src/supabase";
import { shared, tokens } from "../../src/theme";
import type { EmploymentStatus, ProfileRow } from "../../src/types";

/**
 * Edit profile (M2 correction pass) — PATCH /api/mobile/profile.
 *
 * A FULL-FORM save, mirroring the web profile edit form
 * (apps/web/app/profile/page.tsx): the form is pre-filled from
 * the caller's stored `profiles` row (RLS read) and every save
 * sends the complete profileEditSchema field set — the four
 * experience booleans included, carried from the stored row
 * via the switches — so a save can never silently reset a
 * field the form didn't mean to touch. On success we return
 * to Profile, which refetches on focus: the completion % and
 * the verified badge are always derived from the stored row.
 *
 * Client validation is presence/format only; the server
 * schema is authoritative and its messages show verbatim.
 */
export default function ProfileEditScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user.id;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The stored row as loaded — display-only (header strip:
  // avatar, name, completion %). Form fields keep their own
  // state below; the save path is unchanged.
  const [storedProfile, setStoredProfile] = useState<ProfileRow | null>(null);

  const [fullName, setFullName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [country, setCountry] = useState("");
  const [tradingExperience, setTradingExperience] = useState("");
  const [tradingEducation, setTradingEducation] = useState("");
  const [backtestedTrades, setBacktestedTrades] = useState("");
  const [realTradesCount, setRealTradesCount] = useState("");
  const [employmentStatus, setEmploymentStatus] =
    useState<EmploymentStatus>("not_provided");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [tradingCapital, setTradingCapital] = useState("");
  const [backtestingExperience, setBacktestingExperience] = useState(false);
  const [realTradingExperience, setRealTradingExperience] = useState(false);
  const [demoTrading, setDemoTrading] = useState(false);
  const [tradesRealMoney, setTradesRealMoney] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error: readError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (readError) {
      setLoadError(readError.message);
      setLoading(false);
      return;
    }
    const p = (data as ProfileRow | null) ?? null;
    if (p) {
      setStoredProfile(p);
      setFullName(p.full_name ?? "");
      setFatherName(p.father_name ?? "");
      setDateOfBirth(p.date_of_birth ?? "");
      setCountry(p.country ?? "");
      setTradingExperience(p.trading_experience ?? "");
      setTradingEducation(p.trading_education ?? "");
      setBacktestedTrades(numText(p.backtested_trades));
      setRealTradesCount(numText(p.real_trades_count));
      setEmploymentStatus(
        (EMPLOYMENT_STATUS_OPTIONS.some((o) => o.value === p.employment_status)
          ? p.employment_status
          : "not_provided") as EmploymentStatus,
      );
      setMonthlyIncome(numText(p.monthly_income));
      setTradingCapital(numText(p.trading_capital));
      setBacktestingExperience(p.backtesting_experience);
      setRealTradingExperience(p.real_trading_experience);
      setDemoTrading(p.demo_trading);
      setTradesRealMoney(p.trades_real_money);
      setReady(true);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit() {
    if (submitting || !ready) return;
    // Presence/format checks only — the server schema is
    // authoritative and its messages replace these on a 4xx.
    if (fullName.trim() === "") return setError("Full name is required");
    if (dateOfBirth.trim() !== "" && !isDateText(dateOfBirth.trim()))
      return setError("Enter your date of birth as YYYY-MM-DD, or leave it blank.");
    for (const [text, label] of [
      [monthlyIncome, "monthly income"],
      [tradingCapital, "trading capital"],
    ] as const) {
      if (text.trim() !== "" && !isValidNumberText(text))
        return setError(`Enter a valid ${label}, or leave it blank.`);
    }
    for (const [text, label] of [
      [backtestedTrades, "backtested trades"],
      [realTradesCount, "real trades"],
    ] as const) {
      const value = parseNumberText(text);
      if (text.trim() !== "" && (value === null || Number.isNaN(value) || !Number.isInteger(value)))
        return setError(`Enter a whole number for ${label}, or leave it blank.`);
    }
    if (employmentStatus === "employed_other_job" && monthlyIncome.trim() === "")
      return setError(
        "Monthly income is requested when you have another job — or choose a different work status.",
      );
    setError(null);
    setSubmitting(true);
    try {
      await updateProfile({
        fullName: fullName.trim(),
        fatherName: textOrNull(fatherName),
        dateOfBirth: textOrNull(dateOfBirth),
        country: textOrNull(country),
        tradingExperience: textOrNull(tradingExperience),
        tradingEducation: textOrNull(tradingEducation),
        backtestingExperience,
        backtestedTrades: parseNumberText(backtestedTrades),
        realTradingExperience,
        realTradesCount: parseNumberText(realTradesCount),
        demoTrading,
        employmentStatus,
        monthlyIncome: parseNumberText(monthlyIncome),
        tradingCapital: parseNumberText(tradingCapital),
        tradesRealMoney,
      });
      // Back to Profile, which refetches on focus — the
      // completion state shown there is the stored state.
      router.back();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading your profile…" />;

  // Completion of the STORED row, from the one canonical
  // calculator — the same figure the Profile screen shows.
  const completion = storedProfile
    ? calcProfileCompletion(storedProfile)
    : null;

  return (
    <Screen>
      <Text style={shared.title}>Edit profile</Text>
      {loadError ? <ErrorState message={loadError} /> : null}
      {!loadError && !ready ? (
        <ErrorState message="Your profile row could not be loaded. Sign out and back in, then try again." />
      ) : null}
      {ready && storedProfile && completion ? (
        <GradientCard level="elevated">
          <View style={styles.headerStrip}>
            {storedProfile.avatar_url ? (
              <Image
                source={{ uri: storedProfile.avatar_url }}
                style={styles.headerAvatar}
              />
            ) : (
              <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
                <Text style={styles.headerAvatarInitial}>
                  {(storedProfile.full_name ?? session?.user.email ?? "?")
                    .slice(0, 1)
                    .toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={styles.headerName} numberOfLines={1}>
                {storedProfile.full_name ?? "Trader"}
              </Text>
              <Text style={shared.muted}>
                {completion.verified
                  ? "ITG Verified Profile"
                  : "Complete your profile to earn the Verified badge"}
              </Text>
            </View>
            <Text style={styles.headerPct}>{completion.percent}%</Text>
          </View>
        </GradientCard>
      ) : null}
      {ready ? (
        <>
          <GradientCard level="standard">
            <Text style={shared.heading}>Personal information</Text>
            <TextField label="Full name" value={fullName} onChangeText={setFullName} />
            <TextField
              label="Father's name"
              value={fatherName}
              onChangeText={setFatherName}
              placeholder="Not provided"
            />
            <TextField
              label="Date of birth"
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              placeholder="YYYY-MM-DD"
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <TextField
              label="Country"
              value={country}
              onChangeText={setCountry}
              placeholder="Not provided"
            />
          </GradientCard>

          <GradientCard level="standard">
            <Text style={shared.heading}>Trading background</Text>
            <TextField
              label="Trading experience"
              value={tradingExperience}
              onChangeText={setTradingExperience}
              placeholder="Not provided"
            />
            <TextField
              label="Trading education"
              value={tradingEducation}
              onChangeText={setTradingEducation}
              placeholder="Not provided"
            />
            <TextField
              label="Backtested trades"
              value={backtestedTrades}
              onChangeText={setBacktestedTrades}
              placeholder="0"
              keyboardType="number-pad"
            />
            <TextField
              label="Real trades (approx.)"
              value={realTradesCount}
              onChangeText={setRealTradesCount}
              placeholder="0"
              keyboardType="number-pad"
            />
            <ToggleRow
              label="Backtesting experience"
              value={backtestingExperience}
              onChange={setBacktestingExperience}
            />
            <ToggleRow
              label="Real trading experience"
              value={realTradingExperience}
              onChange={setRealTradingExperience}
            />
            <ToggleRow
              label="Demo trading"
              value={demoTrading}
              onChange={setDemoTrading}
            />
          </GradientCard>

          <GradientCard level="standard">
            <Text style={shared.heading}>Work & trading</Text>
            <ChipSelect
              label="Work status"
              options={EMPLOYMENT_STATUS_OPTIONS}
              value={employmentStatus}
              onChange={(value) =>
                setEmploymentStatus(value ?? "not_provided")
              }
              hint="A real work status is required for a complete profile — “Prefer not to say” leaves the profile incomplete."
            />
            <ToggleRow
              label="Trades real money"
              value={tradesRealMoney}
              onChange={setTradesRealMoney}
            />
          </GradientCard>

          <GradientCard level="standard">
            <Text style={shared.heading}>Trading history & capital</Text>
            <TextField
              label="Trading capital (private)"
              value={tradingCapital}
              onChangeText={setTradingCapital}
              placeholder="Not provided"
              keyboardType="decimal-pad"
            />
            <TextField
              label="Monthly income (private, if you have another job)"
              value={monthlyIncome}
              onChangeText={setMonthlyIncome}
              placeholder="Not provided"
              keyboardType="decimal-pad"
            />
            <Text style={styles.hint}>Private — only you can see these values.</Text>
          </GradientCard>

          <SubmitBar
            label="Save profile"
            onPress={handleSubmit}
            submitting={submitting}
            error={error}
          />
        </>
      ) : null}
    </Screen>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field label={label}>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleValue}>{value ? "Yes" : "No"}</Text>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: tokens.glassElevated, true: tokens.blueBright }}
          thumbColor={tokens.textPrimary}
        />
      </View>
    </Field>
  );
}

function numText(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

const styles = StyleSheet.create({
  headerStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  headerAvatarFallback: {
    backgroundColor: tokens.deep,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarInitial: {
    color: tokens.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  headerName: {
    color: tokens.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  headerPct: {
    color: tokens.cyanBright,
    fontSize: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleValue: {
    color: tokens.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  hint: {
    color: tokens.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});
