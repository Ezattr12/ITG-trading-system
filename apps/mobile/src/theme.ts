import { StyleSheet } from "react-native";

/**
 * ITG design tokens for mobile — mirrored from the web app's
 * Phase 18/19 token system (apps/web/app/globals.css, `--itg-*`).
 * One token system across web and mobile: deep purple-black
 * background, frosted glass surfaces, violet primary, cyan/blue
 * secondaries, green profit, red loss, gold reserved for
 * premium/level status only.
 */
export const tokens = {
  bg: "#06030d", // --itg-bg
  bgDeep: "#100020", // --itg-bg-deep
  bgPurple: "#18002f", // --itg-bg-purple
  deep: "#0b0620", // --itg-deep
  violetDeep: "#340266", // --itg-violet-deep
  violet: "#492282", // --itg-violet
  violetLight: "#8b60c7", // --itg-violet-light
  auroraPurple: "#7b2cff", // --itg-aurora-purple
  auroraViolet: "#a855f7", // --itg-aurora-violet
  auroraBlue: "#1677ff", // --itg-aurora-blue
  auroraCyan: "#00cfff", // --itg-aurora-cyan
  blueBright: "#346ce6", // --itg-blue-bright
  cyanBright: "#00d9ff", // --itg-cyan-bright
  glass: "rgba(255, 255, 255, 0.075)", // --itg-glass-standard
  glassElevated: "rgba(255, 255, 255, 0.12)", // --itg-glass-elevated
  glassHero: "rgba(255, 255, 255, 0.16)", // --itg-glass-hero
  glassBorder: "rgba(255, 255, 255, 0.18)", // --itg-glass-border
  glassBorderBright: "rgba(255, 255, 255, 0.28)", // --itg-glass-border-bright
  textPrimary: "#f8f7ff", // --itg-text-primary
  textSecondary: "#d4d5e8", // --itg-text-secondary
  textMuted: "#8589a6", // --itg-text-muted
  profit: "#21f3a5", // --itg-profit
  loss: "#ff4d72", // --itg-loss
  warning: "#f5c451", // --itg-warning
  gold: "#bd935f", // --itg-gold (premium / level status only)
  radiusSm: 14, // --itg-radius-sm
  radiusMd: 20, // --itg-radius-md
  radiusLg: 28, // --itg-radius-lg
  radiusPill: 999, // --itg-radius-pill
} as const;

/** Shared glass-card / layout styles built on the tokens. */
export const shared = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.bg,
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: tokens.glass,
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusMd,
    padding: 16,
    gap: 6,
  },
  heroCard: {
    backgroundColor: tokens.glassHero,
    borderColor: tokens.glassBorderBright,
    borderWidth: 1,
    borderRadius: tokens.radiusLg,
    padding: 20,
    gap: 6,
  },
  title: {
    color: tokens.textPrimary,
    fontSize: 22,
    fontWeight: "700",
  },
  heading: {
    color: tokens.textPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  body: {
    color: tokens.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  muted: {
    color: tokens.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    color: tokens.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  statValue: {
    color: tokens.textPrimary,
    fontSize: 26,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
