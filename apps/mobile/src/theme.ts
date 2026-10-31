import { StyleSheet } from "react-native";

/**
 * ITG design tokens for mobile — one token system across web
 * and mobile (values adapted from the web app's `--itg-*`
 * tokens, apps/web/app/globals.css).
 *
 * Color hierarchy (M2 correction pass): strong black /
 * near-black is the dominant structural base, deep navy
 * carries depth layers and surfaces, blue → cyan is the
 * primary interactive / information color, green is profit /
 * success, red is loss / risk, gold is reserved for level,
 * achievements and premium status, and violet survives only
 * as the AI Coach identity and a restrained atmospheric
 * accent — it no longer paints generic surfaces or controls.
 * Colors are semantic, never decorative noise.
 */
export const tokens = {
  bg: "#04060B", // near-black base (blue-tinted)
  bgDeep: "#060B16", // deep navy — tab bar / deepest layer
  bgPurple: "#0A1322", // legacy name; now a deep-navy depth layer
  deep: "#0C1A30", // deep navy surface (avatar fallback, depth)
  violetDeep: "#2A0A4A", // atmosphere only (single subtle glow)
  violet: "#492282", // AI Coach identity / avatar ring accent only
  violetLight: "#8b60c7", // accent line on the violet identity
  auroraPurple: "#7b2cff", // atmosphere only
  auroraViolet: "#a855f7", // AI Coach identity accents
  auroraBlue: "#1677ff", // aurora depth glow (blue)
  auroraCyan: "#00cfff", // aurora depth glow (cyan)
  blueBright: "#2E7CF6", // primary interactive blue
  cyanBright: "#00CFFF", // primary information cyan (active states)
  glass: "rgba(255, 255, 255, 0.075)", // --itg-glass-standard
  glassElevated: "rgba(255, 255, 255, 0.12)", // --itg-glass-elevated
  glassHero: "rgba(255, 255, 255, 0.16)", // --itg-glass-hero
  glassBorder: "rgba(130, 175, 255, 0.16)", // blue-tinted glass border
  glassBorderBright: "rgba(130, 175, 255, 0.32)", // blue-tinted hero border
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
