import { useCallback, useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth";
import { supabase } from "../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GhostButton,
  GlassCard,
  LoadingState,
  Screen,
} from "../../src/components";
import { formatDate, formatNumber, titleCase } from "../../src/format";
import { shared, tokens } from "../../src/theme";
import type { ProfileRow, UserLevelRow } from "../../src/types";

/**
 * Profile — the caller's own `profiles` row (RLS read), their
 * stored level, and sign-out. Phase 25 adds entry points to
 * the Risk & plan editors and Notifications; profile field
 * editing itself is not part of this phase's workflows.
 */
export default function ProfileScreen() {
  const { session, bootstrap, signOut } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [level, setLevel] = useState<UserLevelRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    const [profileRes, levelRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
      supabase
        .from("user_levels")
        .select("score, score_breakdown, calculated_at, levels(name)")
        .eq("user_id", session.user.id)
        .maybeSingle(),
    ]);
    if (profileRes.error) {
      setError(profileRes.error.message);
    } else {
      setProfile((profileRes.data as ProfileRow | null) ?? null);
      setLevel((levelRes.data as UserLevelRow | null) ?? null);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading your profile…" />;

  const levelNameRaw = level?.levels;
  const levelName = Array.isArray(levelNameRaw)
    ? (levelNameRaw[0]?.name ?? null)
    : (levelNameRaw?.name ?? null);

  const rows: { label: string; value: string }[] = profile
    ? [
        { label: "Email", value: session?.user.email ?? "—" },
        { label: "Country", value: profile.country ?? "—" },
        { label: "Date of birth", value: formatDate(profile.date_of_birth) },
        { label: "Experience", value: titleCase(profile.trading_experience) },
        { label: "Education", value: titleCase(profile.trading_education) },
        { label: "Employment", value: titleCase(profile.employment_status) },
        {
          label: "Trading capital",
          value:
            profile.trading_capital === null
              ? "—"
              : formatNumber(profile.trading_capital, 0),
        },
        { label: "Verification", value: titleCase(profile.verification_status) },
        { label: "Role", value: titleCase(profile.role) },
        {
          label: "Onboarding",
          value:
            bootstrap === null
              ? "—"
              : bootstrap.onboarding_complete
                ? "Complete"
                : "Not complete",
        },
      ]
    : [];

  return (
    <Screen>
      <Text style={shared.title}>Profile</Text>
      {error ? <ErrorState message={error} /> : null}
      {!error && !profile ? (
        <EmptyState
          title="Profile is being set up"
          body="Your profile row is created when you sign in. If this persists, sign out and back in, or complete onboarding in the web app."
        />
      ) : null}
      {profile ? (
        <>
          <GlassCard hero>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              {profile.avatar_url ? (
                <Image
                  source={{ uri: profile.avatar_url }}
                  style={{ width: 64, height: 64, borderRadius: 32 }}
                />
              ) : (
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: tokens.violet,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: tokens.textPrimary, fontSize: 22, fontWeight: "700" }}>
                    {(profile.full_name ?? session?.user.email ?? "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={shared.heading}>{profile.full_name ?? "Trader"}</Text>
                <Text style={shared.muted}>{session?.user.email ?? ""}</Text>
                {levelName ? (
                  <Text style={{ color: tokens.gold, fontWeight: "700", fontSize: 13 }}>
                    {levelName}
                    {level?.score !== null && level?.score !== undefined
                      ? ` · Score ${formatNumber(level.score, 1)}`
                      : ""}
                  </Text>
                ) : (
                  <Text style={shared.muted}>Level not scored yet</Text>
                )}
              </View>
            </View>
          </GlassCard>

          <GlassCard>
            {rows.map((row) => (
              <View key={row.label} style={shared.rowBetween}>
                <Text style={shared.muted}>{row.label}</Text>
                <Text style={{ color: tokens.textSecondary, fontSize: 14 }}>{row.value}</Text>
              </View>
            ))}
          </GlassCard>
        </>
      ) : null}

      <GhostButton
        label="Risk rules & trading plan"
        onPress={() => router.push("/(app)/risk")}
      />
      <GhostButton
        label="Notifications"
        onPress={() => router.push("/(app)/notifications")}
      />
      <GhostButton label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
