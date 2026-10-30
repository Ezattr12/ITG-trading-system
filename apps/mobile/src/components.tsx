import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { shared, tokens } from "./theme";

/** Full-screen shell: deep background + decorative aurora washes (capped, atmospheric only). */
export function Screen({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  const inner = <View style={shared.content}>{children}</View>;
  return (
    <SafeAreaView style={shared.screen} edges={["top", "left", "right"]}>
      <View pointerEvents="none" style={styles.auroraTop} />
      <View pointerEvents="none" style={styles.auroraBottom} />
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
      <ActivityIndicator color={tokens.auroraViolet} size="large" />
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
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
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
    backgroundColor: tokens.violetDeep,
    opacity: 0.35,
  },
  auroraBottom: {
    position: "absolute",
    bottom: -160,
    left: -120,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: tokens.auroraBlue,
    opacity: 0.12,
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
    backgroundColor: tokens.violet,
    borderColor: tokens.glassBorderBright,
    borderWidth: 1,
    borderRadius: tokens.radiusPill,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: tokens.textPrimary,
    fontSize: 15,
    fontWeight: "700",
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
