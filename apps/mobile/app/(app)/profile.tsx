import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { uploadAvatar } from "../../src/api";
import { useAuth } from "../../src/auth";
import { supabase } from "../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GhostButton,
  GradientCard,
  LoadingState,
  PrimaryButton,
  ProgressRing,
  Screen,
} from "../../src/components";
import { FormError } from "../../src/forms";
import { formatDate, formatNumber, titleCase } from "../../src/format";
import { calcProfileCompletion } from "@itg/calc/src/profile-completion";
import {
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

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Bright gold for achievement / level iconography on dark glass. */
const GOLD_BRIGHT = "#E9C37C";

/** Icon per Trading Identity row — labels come from the derivations below. */
const IDENTITY_ICONS: Record<string, IconName> = {
  Markets: "globe",
  "Primary strategy": "layers",
  Experience: "time",
  "Risk profile": "shield-checkmark",
  "Preferred sessions": "moon",
};

/**
 * Profile — premium trader identity page (Phase 19 composition,
 * M2 correction pass; Profile correction pass: physical-glass
 * redesign). Everything shown is the caller's own stored data,
 * read under RLS:
 * - Hero: photo (tap to replace, via the avatar endpoint) in a
 *   blue → cyan gradient ring with a camera badge, name,
 *   professional identity, the level ring + stored score, total
 *   XP (sum of xp_transactions), and the level-band progress
 *   bar (port of the web progressToNextLevel).
 * - "ITG Verified Profile": a profile-COMPLETENESS badge,
 *   derived on every render from the stored row (100% of the
 *   8 required items, computed by the ONE canonical calculator
 *   in @itg/calc — the same module the web app uses). It is
 *   NOT identity / KYC verification — the admin-reviewed
 *   verification_status is shown separately in Details as
 *   "Admin review status".
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
          <GradientCard level="hero">
            <View style={styles.heroRow}>
              <View style={styles.avatarOuter}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change profile photo"
                  onPress={() => void handleAvatarPick()}
                >
                  <LinearGradient
                    colors={[tokens.cyanBright, tokens.blueBright, tokens.royal]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.avatarRing}
                  >
                    {profile.avatar_url ? (
                      <Image
                        source={{ uri: profile.avatar_url }}
                        style={styles.avatarImg}
                      />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarInitial}>
                          {(profile.full_name ?? session?.user.email ?? "?")
                            .slice(0, 1)
                            .toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </LinearGradient>
                  {avatarBusy ? (
                    <View style={styles.avatarBusy}>
                      <ActivityIndicator color={tokens.textPrimary} />
                    </View>
                  ) : null}
                </Pressable>
                <LinearGradient
                  colors={[tokens.blueBright, tokens.royal]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.cameraBadge}
                  pointerEvents="none"
                >
                  <Ionicons name="camera" size={14} color="#FFFFFF" />
                </LinearGradient>
              </View>
              <View style={styles.heroIdentity}>
                <View style={styles.nameRow}>
                  <Text style={styles.heroName} numberOfLines={1}>
                    {profile.full_name ?? "Trader"}
                  </Text>
                  {completion.verified ? (
                    <View style={styles.verifiedCheck}>
                      <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>
                <Text style={shared.muted}>
                  {profile.role === "admin" ? "Admin" : "Professional Trader"}
                  {profile.country ? ` · ${profile.country}` : ""}
                </Text>
                {completion.verified ? (
                  <View style={styles.verifiedPill}>
                    <Ionicons
                      name="shield-checkmark"
                      size={14}
                      color={tokens.cyanBright}
                    />
                    <Text style={styles.verifiedPillText}>
                      ITG Verified Profile
                    </Text>
                  </View>
                ) : (
                  <View style={styles.progressPill}>
                    <Text style={styles.progressPillText}>
                      Profile {completion.percent}% complete
                      {completion.nextStep ? ` · ${completion.nextStep}` : ""}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <Text style={styles.avatarHint}>
              {avatarBusy ? "Uploading photo…" : "Tap your photo to change it"}
            </Text>
            <FormError message={avatarError} />
            <Text style={shared.muted}>
              {completion.verified
                ? "Profile complete — this badge confirms your profile information is complete. It is not identity (KYC) verification."
                : "The ITG Verified Profile badge activates when your profile information is complete. It is a completeness badge, not identity verification."}
            </Text>

            <View style={styles.xpBlock}>
              <View style={styles.xpRow}>
                <ProgressRing
                  size={64}
                  strokeWidth={5}
                  progress={progress ? progress.progressPct / 100 : 0}
                >
                  <Text style={styles.ringLevelName} numberOfLines={1}>
                    {progress?.currentLevel ?? levelName ?? "—"}
                  </Text>
                </ProgressRing>
                <View style={styles.xpColumn}>
                  <View style={shared.rowBetween}>
                    {levelName ? (
                      <Text style={styles.xpLevelLine}>
                        {levelName}
                        {score !== null ? (
                          <Text style={styles.xpScoreText}>
                            {` · Score ${formatNumber(score, 1)}`}
                          </Text>
                        ) : null}
                      </Text>
                    ) : (
                      <Text style={shared.muted}>Level not scored yet</Text>
                    )}
                    <Text style={shared.muted}>
                      {progress === null
                        ? "Journal trades to earn a level"
                        : progress.nextLevel === null
                          ? "Top level reached"
                          : `${formatNumber(progress.pointsToNext, 1)} points to ${progress.nextLevel}`}
                    </Text>
                  </View>
                  <Text style={styles.xpValue}>
                    {formatNumber(xpTotal, 0)}
                    <Text style={styles.xpCaption}> total XP earned</Text>
                  </Text>
                  <View style={styles.barWrap}>
                    <View style={styles.barTrack} />
                    <LinearGradient
                      colors={[tokens.blueBright, tokens.cyanBright]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[
                        styles.barFill,
                        { width: `${progress?.progressPct ?? 0}%` },
                      ]}
                    />
                  </View>
                </View>
              </View>
              <Text style={shared.muted}>
                Your level is scored on discipline, risk, journaling, goals,
                psychology, strategy, consistency and performance — not profit
                alone.
              </Text>
            </View>
          </GradientCard>

          <GradientCard level="elevated">
            <View style={styles.statRow}>
              <StatTile
                icon="swap-horizontal"
                label="Total trades"
                value={String(stats.totalTrades)}
              />
              <View style={styles.statDivider} />
              <StatTile
                icon="trophy"
                label="Win rate"
                value={
                  stats.winRate === null ? "—" : `${Math.round(stats.winRate)}%`
                }
                valueColor={
                  stats.winRate !== null && stats.winRate >= 50
                    ? tokens.profit
                    : undefined
                }
              />
              <View style={styles.statDivider} />
              <StatTile
                icon="scale"
                label="Profit factor"
                value={
                  stats.profitFactor === null
                    ? "—"
                    : formatNumber(stats.profitFactor)
                }
              />
              <View style={styles.statDivider} />
              <StatTile
                icon="pulse"
                label="Average R"
                value={stats.avgR === null ? "—" : formatNumber(stats.avgR)}
                valueColor={
                  stats.avgR === null
                    ? undefined
                    : stats.avgR >= 0
                      ? tokens.profit
                      : tokens.loss
                }
              />
            </View>
            {stats.totalTrades === 0 ? (
              <Text style={shared.muted}>
                Statistics appear once you have closed trades. Nothing here is
                estimated.
              </Text>
            ) : null}
          </GradientCard>

          <GradientCard level="standard">
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <LinearGradient
                  colors={[tokens.royal, tokens.azure]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sectionIconTile}
                >
                  <Ionicons name="person" size={15} color={tokens.cyanBright} />
                </LinearGradient>
                <Text style={shared.heading}>Trading Identity</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                onPress={() => router.push("/(app)/profile-edit")}
                style={({ pressed }) => [
                  styles.editPill,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Ionicons name="pencil" size={12} color={tokens.cyanBright} />
                <Text style={styles.editPillText}>Edit</Text>
              </Pressable>
            </View>
            {identityRows.length === 0 ? (
              <Text style={shared.muted}>
                Not provided yet — set a trading plan or log trades and your
                identity appears here.
              </Text>
            ) : (
              <View style={styles.identityGrid}>
                {identityRows.map((row) => (
                  <IdentityModule
                    key={row.label}
                    icon={IDENTITY_ICONS[row.label] ?? "ellipse"}
                    label={row.label}
                    value={row.value}
                  />
                ))}
              </View>
            )}
          </GradientCard>

          <GradientCard level="standard">
            <View style={styles.sectionHeaderLeft}>
              <LinearGradient
                colors={[tokens.royal, tokens.azure]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sectionIconTile}
              >
                <Ionicons name="trophy" size={15} color={GOLD_BRIGHT} />
              </LinearGradient>
              <Text style={shared.heading}>Achievements</Text>
            </View>
            {achievements.length === 0 ? (
              <Text style={shared.muted}>
                No achievements yet — they unlock as you trade and review.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.achievementScroll}
                contentContainerStyle={styles.achievementRow}
              >
                {achievements.map((a) => (
                  <View
                    key={`${a.name}-${a.unlockedAt}`}
                    style={styles.achievementCard}
                  >
                    <LinearGradient
                      colors={[
                        "rgba(233, 195, 124, 0.22)",
                        "rgba(189, 147, 95, 0.08)",
                      ]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.achievementMedallion}
                    >
                      <Ionicons name="trophy" size={20} color={GOLD_BRIGHT} />
                    </LinearGradient>
                    <Text style={styles.achievementName} numberOfLines={2}>
                      {a.name}
                    </Text>
                    <Text style={styles.achievementDate}>
                      {formatDate(a.unlockedAt)}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </GradientCard>

          <GradientCard level="elevated">
            <View style={styles.completionRow}>
              <ProgressRing
                size={84}
                strokeWidth={7}
                progress={completion.percent / 100}
              >
                <Text style={styles.completionRingPct}>
                  {completion.percent}%
                </Text>
              </ProgressRing>
              <View style={styles.completionBody}>
                <Text style={shared.heading}>Profile completion</Text>
                {completion.missing.length === 0 ? (
                  <Text style={styles.completionDoneText}>
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
              </View>
            </View>
          </GradientCard>

          <GradientCard level="standard">
            {detailRows.map((row, index) => (
              <View
                key={row.label}
                style={[
                  styles.detailRow,
                  index > 0 && styles.detailRowBorder,
                ]}
              >
                <Text style={shared.muted}>{row.label}</Text>
                <Text style={styles.detailValue}>{row.value}</Text>
              </View>
            ))}
          </GradientCard>
        </>
      ) : null}

      <PrimaryButton
        label="Edit profile"
        onPress={() => router.push("/(app)/profile-edit")}
        gradient
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

function StatTile({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: IconName;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.statTile}>
      <LinearGradient
        colors={[tokens.royal, tokens.azure]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.statIconTile}
      >
        <Ionicons
          name={icon}
          size={15}
          color={icon === "trophy" ? GOLD_BRIGHT : tokens.cyanBright}
        />
      </LinearGradient>
      <Text style={styles.statTileLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[
          styles.statTileValue,
          valueColor ? { color: valueColor } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function IdentityModule({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.identityModule}>
      <LinearGradient
        colors={[tokens.royal, tokens.azure]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.identityIconTile}
      >
        <Ionicons name={icon} size={17} color={tokens.cyanBright} />
      </LinearGradient>
      <View style={styles.identityText}>
        <Text style={shared.label}>{label}</Text>
        <Text style={styles.identityValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  avatarOuter: {
    width: 104,
    height: 104,
    shadowColor: tokens.cyanBright,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 10,
  },
  avatarRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: tokens.deep,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: tokens.textPrimary,
    fontSize: 34,
    fontWeight: "700",
  },
  avatarBusy: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 48,
    backgroundColor: "rgba(4, 6, 11, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: tokens.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  heroIdentity: {
    flex: 1,
    gap: 5,
    paddingTop: 4,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  heroName: {
    color: tokens.textPrimary,
    fontSize: 21,
    fontWeight: "800",
    flexShrink: 1,
  },
  verifiedCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: tokens.blueBright,
    alignItems: "center",
    justifyContent: "center",
  },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderColor: tokens.glassBorderBright,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    backgroundColor: "rgba(18, 104, 216, 0.25)",
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginTop: 2,
  },
  verifiedPillText: {
    color: tokens.textPrimary,
    fontWeight: "700",
    fontSize: 12.5,
  },
  progressPill: {
    alignSelf: "flex-start",
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    backgroundColor: tokens.glass,
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginTop: 2,
  },
  progressPillText: {
    color: tokens.textSecondary,
    fontWeight: "600",
    fontSize: 12.5,
  },
  avatarHint: {
    color: tokens.textMuted,
    fontSize: 12,
  },
  xpBlock: {
    borderTopColor: tokens.glassBorder,
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 4,
    gap: 10,
  },
  xpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  ringLevelName: {
    color: tokens.gold,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  xpColumn: {
    flex: 1,
    gap: 6,
  },
  xpLevelLine: {
    color: tokens.gold,
    fontWeight: "700",
    fontSize: 13,
    flexShrink: 1,
  },
  xpScoreText: {
    color: tokens.textSecondary,
    fontWeight: "600",
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
  barWrap: {
    height: 10,
    justifyContent: "center",
  },
  barTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  barFill: {
    height: 10,
    borderRadius: 5,
    shadowColor: tokens.cyanBright,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 4,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  statTile: {
    flex: 1,
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    marginVertical: 4,
  },
  statIconTile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: tokens.glassBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  statTileLabel: {
    color: tokens.textMuted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    textAlign: "center",
    minHeight: 26,
  },
  statTileValue: {
    color: tokens.textPrimary,
    fontSize: 19,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionIconTile: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: tokens.glassBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  editPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderColor: tokens.glassBorderBright,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    backgroundColor: "rgba(18, 104, 216, 0.18)",
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  editPillText: {
    color: tokens.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  identityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
  },
  identityModule: {
    flexBasis: "47.5%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  identityIconTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: tokens.glassBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  identityValue: {
    color: tokens.textPrimary,
    fontSize: 13.5,
    fontWeight: "600",
    lineHeight: 18,
  },
  achievementScroll: {
    marginHorizontal: -16,
  },
  achievementRow: {
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  achievementCard: {
    width: 118,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: tokens.glassBorder,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    padding: 12,
    alignItems: "center",
    gap: 6,
  },
  achievementMedallion: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(233, 195, 124, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  achievementName: {
    color: tokens.textPrimary,
    fontSize: 12.5,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 16,
    minHeight: 32,
  },
  achievementDate: {
    color: tokens.textMuted,
    fontSize: 11,
    textAlign: "center",
  },
  completionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  completionBody: {
    flex: 1,
    gap: 6,
  },
  completionRingPct: {
    color: tokens.cyanBright,
    fontSize: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  completionDoneText: {
    color: tokens.profit,
    fontSize: 13,
    lineHeight: 18,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 7,
  },
  detailRowBorder: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  detailValue: {
    color: tokens.textSecondary,
    fontSize: 14,
    flexShrink: 1,
    textAlign: "right",
  },
});
