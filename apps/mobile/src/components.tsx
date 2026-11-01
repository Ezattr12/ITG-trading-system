import { useId, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
} from "react-native-svg";
import { shared, tokens } from "./theme";

/**
 * Full-screen shell: near-black background + restrained aurora
 * depth washes — deep blue and cyan carry the depth, with ONE
 * subtle violet glow as atmosphere only (violet is the AI /
 * premium accent, not the UI's base color).
 */
export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Extra style for the content container (e.g. flex: 1 for a pinned-composer layout). */
  contentStyle?: ViewStyle;
}) {
  const inner = <View style={[shared.content, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView style={shared.screen} edges={["top", "left", "right"]}>
      <View pointerEvents="none" style={styles.auroraTop} />
      <View pointerEvents="none" style={styles.auroraBottom} />
      <View pointerEvents="none" style={styles.auroraVioletGlow} />
      {scroll ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function GlassCard({
  children,
  hero = false,
}: {
  children: ReactNode;
  hero?: boolean;
}) {
  return <View style={hero ? shared.heroCard : shared.card}>{children}</View>;
}

/**
 * Physical-glass card (Profile correction pass) — a real
 * navy → blue → black gradient surface with a bright top-edge
 * highlight and a deep shadow, in three depths matching the
 * reference hierarchy:
 * - hero (L3): the identity card — full deep-blue gradient,
 *   bright border, blue glow shadow.
 * - elevated (L2): stats / completion panels — mid gradient.
 * - standard (L1): grouped sections — faintest gradient tint.
 * Additive: the flat GlassCard above is untouched and every
 * existing screen keeps its current rendering.
 */
const GRADIENT_CARD_LEVELS = {
  hero: {
    colors: ["#0B3F91", "#08245A", "#06152F", "#03050A"],
    locations: [0, 0.38, 0.72, 1],
    borderColor: tokens.glassBorderBright,
    borderRadius: tokens.radiusLg,
    padding: 20,
    shadowColor: tokens.royal,
    shadowOpacity: 0.35,
    shadowRadius: 30,
    elevation: 16,
  },
  elevated: {
    colors: [
      "rgba(18, 104, 216, 0.26)",
      "rgba(11, 63, 145, 0.18)",
      "rgba(6, 21, 47, 0.24)",
    ],
    locations: [0, 0.55, 1],
    borderColor: tokens.glassBorderBright,
    borderRadius: tokens.radiusMd,
    padding: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 10,
  },
  standard: {
    colors: [
      "rgba(46, 124, 246, 0.12)",
      "rgba(255, 255, 255, 0.055)",
      "rgba(255, 255, 255, 0.03)",
    ],
    locations: [0, 0.55, 1],
    borderColor: tokens.glassBorder,
    borderRadius: tokens.radiusMd,
    padding: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
} as const;

export function GradientCard({
  level = "standard",
  children,
  style,
}: {
  level?: keyof typeof GRADIENT_CARD_LEVELS;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const config = GRADIENT_CARD_LEVELS[level];
  return (
    <View
      style={[
        {
          borderRadius: config.borderRadius,
          borderWidth: 1,
          borderColor: config.borderColor,
          backgroundColor: tokens.bgDeep,
          shadowColor: config.shadowColor,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: config.shadowOpacity,
          shadowRadius: config.shadowRadius,
          elevation: config.elevation,
        },
        style,
      ]}
    >
      <LinearGradient
        colors={[...config.colors]}
        locations={[...config.locations]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.35, y: 1 }}
        style={{
          borderRadius: config.borderRadius - 1,
          padding: config.padding,
          gap: 6,
          overflow: "hidden",
        }}
      >
        {/* Bright top-edge light — the glass reflection line. */}
        <View pointerEvents="none" style={styles.glassTopEdge} />
        {children}
      </LinearGradient>
    </View>
  );
}

/**
 * SVG progress ring with a blue → cyan gradient stroke (or a
 * solid `color` stroke when `gradient` is false). Children
 * render centred inside the ring. Progress is 0–1 and clamps.
 */
export function ProgressRing({
  size = 84,
  strokeWidth = 7,
  progress,
  color,
  gradient = true,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  progress: number;
  color?: string;
  gradient?: boolean;
  children?: ReactNode;
}) {
  const rawId = useId();
  const gradientId = `ring-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={tokens.blueBright} />
            <Stop offset="1" stopColor={tokens.cyanBright} />
          </SvgGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.10)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {clamped > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={gradient ? `url(#${gradientId})` : (color ?? tokens.cyanBright)}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={circumference * (1 - clamped)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children ? (
        <View style={styles.ringCenter} pointerEvents="none">
          {children}
        </View>
      ) : null}
    </View>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss" | "gold" | "default";
}) {
  const color =
    tone === "profit"
      ? tokens.profit
      : tone === "loss"
        ? tokens.loss
        : tone === "gold"
          ? tokens.gold
          : tokens.textPrimary;
  return (
    <View style={styles.stat}>
      <Text style={shared.label}>{label}</Text>
      <Text style={[shared.statValue, { color }]}>{value}</Text>
    </View>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={tokens.cyanBright} size="large" />
      <Text style={shared.muted}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <GlassCard>
      <Text style={shared.heading}>{title}</Text>
      <Text style={shared.muted}>{body}</Text>
    </GlassCard>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <GlassCard>
      <Text style={[shared.heading, { color: tokens.loss }]}>Something went wrong</Text>
      <Text style={shared.muted}>{message}</Text>
    </GlassCard>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  gradient = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shows a spinner and blocks presses — double-submit protection. */
  loading?: boolean;
  /** Blue → cyan gradient fill (Profile correction pass). Opt-in; the flat institutional-blue rendering is unchanged by default. */
  gradient?: boolean;
}) {
  const blocked = disabled || loading;
  const content = loading ? (
    <ActivityIndicator color={tokens.textPrimary} />
  ) : (
    <Text style={styles.primaryButtonText}>{label}</Text>
  );
  if (gradient) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={blocked}
        onPress={onPress}
        style={({ pressed }) => [
          styles.primaryButtonGradientShell,
          pressed && { opacity: 0.85 },
          blocked && { opacity: 0.45 },
        ]}
      >
        <LinearGradient
          colors={[tokens.royal, tokens.blueBright, tokens.cyanBright]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.primaryButtonGradientFill}
        >
          {content}
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && { opacity: 0.85 },
        blocked && { opacity: 0.45 },
      ]}
    >
      {content}
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.75 }]}
    >
      <Text style={styles.ghostButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  auroraTop: {
    position: "absolute",
    top: -140,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: tokens.auroraBlue,
    opacity: 0.16,
  },
  auroraBottom: {
    position: "absolute",
    bottom: -160,
    left: -120,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: tokens.auroraCyan,
    opacity: 0.07,
  },
  auroraVioletGlow: {
    position: "absolute",
    top: "38%",
    left: -160,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: tokens.auroraPurple,
    opacity: 0.05,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 48,
  },
  stat: {
    gap: 4,
    minWidth: "44%",
    flexGrow: 1,
  },
  primaryButton: {
    // Primary actions are blue (institutional primary), with a
    // bright blue-tinted border as the highlight — no gradient.
    backgroundColor: tokens.blueBright,
    borderColor: tokens.glassBorderBright,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonGradientShell: {
    borderColor: tokens.glassBorderBright,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    overflow: "hidden",
    shadowColor: tokens.royal,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  primaryButtonGradientFill: {
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: tokens.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  glassTopEdge: {
    position: "absolute",
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.28)",
  },
  ringCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostButton: {
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: tokens.glass,
  },
  ghostButtonText: {
    color: tokens.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
});
