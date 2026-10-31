import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { uploadAvatar } from "../../src/api";
import { useAuth } from "../../src/auth";
import { supabase } from "../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GhostButton,
  GlassCard,
  LoadingState,
  PrimaryButton,
  Screen,
  Stat,
} from "../../src/components";
import { FormError } from "../../src/forms";
import { formatDate, formatNumber, titleCase } from "../../src/format";
import {
  calcProfileCompletion,
  identityMarkets,
  identitySessions,
  mostUsedStrategy,
  profileStats,
  progressToNextLevel,
  sessionLabel,
  type ProfileTradeLite,
} from "../../src/profile";
import { shared, tokens } from "../../src/theme";
import type {
  EarnedAchievementRow,
  LevelRowLite,
  ProfileRow,
  RiskRulesRow,
  TradingPlanRow,
  UserLevelRow,
} from "../../src/types";

/**
 * Profile — premium trader identity page (Phase 19 composition,
 * M2 correction pass). Everything shown is the caller's own
 * stored data, read under RLS:
 * - Hero: photo (tap to replace, via the avatar endpoint),
 *   name, professional identity, level + stored score, total
 *   XP (sum of xp_transactions), and the level-band progress
 *   bar (port of the web progressToNextLevel).
 * - "ITG Verified Profile": a profile-COMPLETENESS badge,
 *   derived on every render from the stored row (100% of the
 *   8 required items in src/profile.ts). It is NOT identity /
 *   KYC verification — the admin-reviewed verification_status
 *   is shown separately in Details as "Admin review status".
 * - Stats / Trading Identity / Achievements: derived from the
 *   caller's closed trades, active plan and risk rules, and
 *   earned user_achievements — never invented; a value with
 *   no source is omitted or shown as an honest empty state.
 */
export default function ProfileScreen() {
  const { session, bootstrap, signOut } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [level, setLevel] = useState<UserLevelRow | null>(null);
  const [levels, setLevels] = useState<LevelRowLite[]>([]);
  const [xpTotal, setXpTotal] = useState(0);
  const [trades, setTrades] = useState<ProfileTradeLite[]>([]);
  const [plan, setPlan] = useState<TradingPlanRow | null>(null);
  const [rules, setRules] = useState<RiskRulesRow | null>(null);
  const [achievements, setAchievements] = useState<
    { name: string; unlockedAt: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    const userId = session.user.id;
    const [
      profileRes,
      levelRes,
      levelsRes,
      xpRes,
      tradesRes,
      planRes,
      rulesRes,
      achievementsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("user_levels")
        .select("score, score_breakdown, calculated_at, levels(name)")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("levels")
        .select("name, min_score, max_score")
        .order("min_score", { ascending: true }),
      supabase.from("xp_transactions").select("amount").eq("user_id", userId),
      // The web profile's stat set: closed trades with a
      // stored P&L, most recent first, capped at 500.
      supabase
        .from("trades")
        .select("id, pair, session, strategy_id, pnl, r_multiple")
        .eq("user_id", userId)
        .eq("status", "closed")
        .not("pnl", "is", null)
        .order("closed_at", { ascending: false })
        .limit(500),
      supabase
        .from("trading_plans")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
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
        .from("user_achievements")
        .select("unlocked_at, achievements(name)")
        .eq("user_id", userId)
        .order("unlocked_at", { ascending: false }),
    ]);
    if (profileRes.error) {
      setError(profileRes.error.message);
      setLoading(false);
      return;
    }
    setProfile((profileRes.data as ProfileRow | null) ?? null);
    setLevel((levelRes.data as UserLevelRow | null) ?? null);
    setLevels((levelsRes.data ?? []) as LevelRowLite[]);
    setXpTotal(
      ((xpRes.data ?? []) as { amount: number | string }[]).reduce(
        (sum, row) => sum + Number(row.amount ?? 0),
        0,
      ),
    );
    // Strategy names for the closed trades (the web analytics
    // bundle resolves them the same way).
    const tradeRows = (tradesRes.data ?? []) as {
      pair: string;
      session: string | null;
      strategy_id: string | null;
      pnl: number | string;
      r_multiple: number | string | null;
    }[];
    const strategyIds = [
      ...new Set(tradeRows.map((t) => t.strategy_id).filter(Boolean)),
    ] as string[];
    let strategyNames = new Map<string, string>();
    if (strategyIds.length > 0) {
      const { data: strategyRows } = await supabase
        .from("strategies")
        .select("id, name")
        .in("id", strategyIds);
      strategyNames = new Map(
        ((strategyRows ?? []) as { id: string; name: string }[]).map((s) => [
          s.id,
          s.name,
        ]),
      );
    }
    setTrades(
      tradeRows.map((t) => ({
        pair: t.pair,
        session: t.session,
        strategyName: t.strategy_id
          ? (strategyNames.get(t.strategy_id) ?? null)
          : null,
        pnl: Number(t.pnl ?? 0),
        rMultiple: t.r_multiple === null ? null : Number(t.r_multiple),
      })),
    );
    setPlan((planRes.data as TradingPlanRow | null) ?? null);
    setRules((rulesRes.data as RiskRulesRow | null) ?? null);
    setAchievements(
      ((achievementsRes.data ?? []) as EarnedAchievementRow[]).map((row) => {
        const joined = Array.isArray(row.achievements)
          ? row.achievements[0]
          : row.achievements;
        return { name: joined?.name ?? "Achievement", unlockedAt: row.unlocked_at };
      }),
    );
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);
  // Refetch on focus so a profile edit (or an avatar upload on
  // another screen) is reflected immediately on return — the
  // completion state is always derived from the stored row.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleAvatarPick() {
    if (avatarBusy) return;
    setAvatarError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAvatarError("Photo library access is needed to set a profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    // The server's avatar rules (shared with web): an image,
    // at most 2 MB. Checked here too so an oversized photo
    // fails inline instead of after an upload.
    if (asset.fileSize !== undefined && asset.fileSize > 2 * 1024 * 1024) {
      setAvatarError("Profile photo must be 2 MB or smaller.");
      return;
    }
    setAvatarBusy(true);
    try {
      await uploadAvatar({
        uri: asset.uri,
        name: asset.fileName ?? `avatar-${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      });
      await load();
    } catch (e) {
      setAvatarError(
        e instanceof Error ? e.message : "Something went wrong. Please try again.",
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading your profile…" />;

  const levelNameRaw = level?.levels;
  const levelName = Array.isArray(levelNameRaw)
    ? (levelNameRaw[0]?.name ?? null)
    : (levelNameRaw?.name ?? null);
  const score = level?.score ?? null;
  const progress = progressToNextLevel(score, levels);
  const completion = profile ? calcProfileCompletion(profile) : null;
  const stats = profileStats(trades);
  const markets = identityMarkets(plan?.markets, trades);
  const sessions = identitySessions(plan?.sessions, trades);
  const primaryStrategy = mostUsedStrategy(trades);

  const identityRows: { label: string; value: string }[] = [];
  if (markets.length > 0) {
    identityRows.push({ label: "Markets", value: markets.join(", ") });
  }
  if (primaryStrategy) {
    identityRows.push({ label: "Primary strategy", value: primaryStrategy });
  }
  if (profile?.trading_experience) {
    identityRows.push({
      label: "Experience",
      value: titleCase(profile.trading_experience),
    });
  }
  if (rules?.max_risk_per_trade_pct !== null && rules?.max_risk_per_trade_pct !== undefined) {
    identityRows.push({
      label: "Risk profile",
      value: `${formatNumber(rules.max_risk_per_trade_pct)}% per trade`,
    });
  }
  if (sessions.length > 0) {
    identityRows.push({
      label: "Preferred sessions",
      value: sessions.map(sessionLabel).join(" / "),
    });
  }

  const adminReviewLabel =
    profile?.verification_status === "verified"
      ? "Verified"
      : profile?.verification_status === "partial"
        ? "Partially verified"
        : "Not provided";

  const detailRows: { label: string; value: string }[] = profile
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
        // The admin-reviewed status — a separate thing from the
        // completeness badge in the hero, and labelled so the
        // two can never be confused.
        { label: "Admin review status", value: adminReviewLabel },
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
      {profile && completion ? (
        <>
          <GlassCard hero>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
                onPress={() => void handleAvatarPick()}
                style={styles.avatarWrap}
              >
                {profile.avatar_url ? (
                  <Image
                    source={{ uri: profile.avatar_url }}
                    style={styles.avatar}
                  />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text
                      style={{
                        color: tokens.textPrimary,
                        fontSize: 22,
                        fontWeight: "700",
                      }}
                    >
                      {(profile.full_name ?? session?.user.email ?? "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </Text>
                  </View>
                )}
                {avatarBusy ? (
                  <View style={styles.avatarBusy}>
                    <ActivityIndicator color={tokens.textPrimary} />
                  </View>
                ) : null}
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={shared.heading}>{profile.full_name ?? "Trader"}</Text>
                <Text style={shared.muted}>
                  {profile.role === "admin" ? "Admin" : "Professional Trader"}
                  {profile.country ? ` · ${profile.country}` : ""}
                </Text>
                {levelName ? (
                  <Text style={{ color: tokens.gold, fontWeight: "700", fontSize: 13 }}>
                    {levelName}
                    {score !== null ? ` · Score ${formatNumber(score, 1)}` : ""}
                  </Text>
                ) : (
                  <Text style={shared.muted}>Level not scored yet</Text>
                )}
              </View>
            </View>
            <Text style={styles.avatarHint}>
              {avatarBusy ? "Uploading photo…" : "Tap your photo to change it"}
            </Text>
            <FormError message={avatarError} />

            {completion.verified ? (
              <View style={styles.verifiedPill}>
                <Text style={{ color: tokens.profit, fontWeight: "800" }}>✓</Text>
                <Text style={{ color: tokens.textPrimary, fontWeight: "700", fontSize: 13 }}>
                  ITG Verified Profile
                </Text>
              </View>
            ) : (
              <View style={styles.progressPill}>
                <Text style={{ color: tokens.textSecondary, fontWeight: "600", fontSize: 13 }}>
                  Profile {completion.percent}% complete
                  {completion.nextStep ? ` · ${completion.nextStep}` : ""}
                </Text>
              </View>
            )}
            <Text style={shared.muted}>
              {completion.verified
                ? "Profile complete — this badge confirms your profile information is complete. It is not identity (KYC) verification."
                : "The ITG Verified Profile badge activates when your profile information is complete. It is a completeness badge, not identity verification."}
            </Text>

            <View style={styles.xpBlock}>
              <View style={shared.rowBetween}>
                <Text style={styles.xpValue}>
                  {formatNumber(xpTotal, 0)}
                  <Text style={styles.xpCaption}> total XP earned</Text>
                </Text>
                <Text style={shared.muted}>
                  {progress === null
                    ? "Journal trades to earn a level"
                    : progress.nextLevel === null
                      ? "Top level reached"
                      : `${formatNumber(progress.pointsToNext, 1)} points to ${progress.nextLevel}`}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${progress?.progressPct ?? 0}%` },
                  ]}
                />
              </View>
              <Text style={shared.muted}>
                Your level is scored on discipline, risk, journaling, goals,
                psychology, strategy, consistency and performance — not profit
                alone.
              </Text>
            </View>
          </GlassCard>

          <GlassCard>
            <View style={shared.rowBetween}>
              <Text style={shared.heading}>Profile completion</Text>
              <Text style={styles.completionPct}>{completion.percent}%</Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[styles.barFill, { width: `${completion.percent}%` }]}
              />
            </View>
            {completion.missing.length === 0 ? (
              <Text style={{ color: tokens.profit, fontSize: 13, lineHeight: 18 }}>
                ✓ Your profile is complete — the ITG Verified Profile badge is
                active.
              </Text>
            ) : (
              completion.missing.map((item) => (
                <Text key={item.key} style={shared.muted}>
                  • {item.hint}
                </Text>
              ))
            )}
          </GlassCard>

          <GlassCard>
            <Text style={shared.heading}>Key stats</Text>
            <View style={styles.statGrid}>
              <Stat label="Total trades" value={String(stats.totalTrades)} />
              <Stat
                label="Win rate"
                value={
                  stats.winRate === null ? "—" : `${Math.round(stats.winRate)}%`
                }
                tone={
                  stats.winRate !== null && stats.winRate >= 50
                    ? "profit"
                    : "default"
                }
              />
              <Stat
                label="Profit factor"
                value={
                  stats.profitFactor === null
                    ? "—"
                    : formatNumber(stats.profitFactor)
                }
              />
              <Stat
                label="Average R"
                value={stats.avgR === null ? "—" : formatNumber(stats.avgR)}
                tone={
                  stats.avgR === null
                    ? "default"
                    : stats.avgR >= 0
                      ? "profit"
                      : "loss"
                }
              />
            </View>
            {stats.totalTrades === 0 ? (
              <Text style={shared.muted}>
                Statistics appear once you have closed trades. Nothing here is
                estimated.
              </Text>
            ) : null}
          </GlassCard>

          <GlassCard>
            <Text style={shared.heading}>Trading identity</Text>
            {identityRows.length === 0 ? (
              <Text style={shared.muted}>
                Not provided yet — set a trading plan or log trades and your
                identity appears here.
              </Text>
            ) : (
              identityRows.map((row) => (
                <View key={row.label} style={shared.rowBetween}>
                  <Text style={shared.muted}>{row.label}</Text>
                  <Text
                    style={{
                      color: tokens.textSecondary,
                      fontSize: 14,
                      flexShrink: 1,
                      textAlign: "right",
                    }}
                  >
                    {row.value}
                  </Text>
                </View>
              ))
            )}
          </GlassCard>

          <GlassCard>
            <Text style={shared.heading}>Achievements</Text>
            {achievements.length === 0 ? (
              <Text style={shared.muted}>
                No achievements yet — they unlock as you trade and review.
              </Text>
            ) : (
              achievements.map((a) => (
                <View key={`${a.name}-${a.unlockedAt}`} style={shared.rowBetween}>
                  <View style={styles.achievementDot} />
                  <Text
                    style={{ color: tokens.textSecondary, fontSize: 14, flex: 1, marginLeft: 8 }}
                  >
                    {a.name}
                  </Text>
                  <Text style={shared.muted}>{formatDate(a.unlockedAt)}</Text>
                </View>
              ))
            )}
          </GlassCard>

          <GlassCard>
            {detailRows.map((row) => (
              <View key={row.label} style={shared.rowBetween}>
                <Text style={shared.muted}>{row.label}</Text>
                <Text style={{ color: tokens.textSecondary, fontSize: 14 }}>
                  {row.value}
                </Text>
              </View>
            ))}
          </GlassCard>
        </>
      ) : null}

      <PrimaryButton
        label="Edit profile"
        onPress={() => router.push("/(app)/profile-edit")}
      />
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

const styles = StyleSheet.create({
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    // The one violet accent kept on Profile: the avatar ring.
    borderColor: tokens.violetLight,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  avatarFallback: {
    backgroundColor: tokens.deep,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBusy: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 34,
    backgroundColor: "rgba(4, 6, 11, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHint: {
    color: tokens.textMuted,
    fontSize: 12,
  },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderColor: tokens.profit,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    backgroundColor: "rgba(33, 243, 165, 0.10)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  progressPill: {
    alignSelf: "flex-start",
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    backgroundColor: tokens.glass,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  xpBlock: {
    borderTopColor: tokens.glassBorder,
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  xpValue: {
    color: tokens.textPrimary,
    fontSize: 20,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  xpCaption: {
    color: tokens.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },
  completionPct: {
    color: tokens.cyanBright,
    fontSize: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.glassElevated,
    overflow: "hidden",
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.blueBright,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  achievementDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    // Gold is reserved for achievements / premium recognition.
    backgroundColor: tokens.gold,
  },
});
