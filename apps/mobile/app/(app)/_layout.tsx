import { useEffect, useState, type ComponentProps } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, Tabs, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { LoadingState } from "../../src/components";
import { tokens } from "../../src/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Signed-in tab shell. Guards: no session → login; biometric
 * gate locked → lock screen. Tabs follow the web app's primary
 * navigation (Dashboard, Trades, Analytics, Goals) plus Coach
 * and Profile, rendered by the floating glass dock below.
 */
export default function AppLayout() {
  const { session, initializing, lockState } = useAuth();

  if (initializing || lockState === "checking") {
    return <LoadingState label="Restoring your session…" />;
  }
  if (!session) return <Redirect href="/(auth)/login" />;
  if (lockState === "locked") return <Redirect href="/lock" />;

  return (
    <Tabs
      tabBar={(props) => <GlassDock {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: tokens.bg },
        headerTitleStyle: { color: tokens.textPrimary },
        headerShadowVisible: false,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard" }} />
      <Tabs.Screen name="trades" options={{ title: "Trades" }} />
      <Tabs.Screen name="analytics" options={{ title: "Analytics" }} />
      <Tabs.Screen name="goals" options={{ title: "Goals" }} />
      <Tabs.Screen name="coach" options={{ title: "Coach" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      {/* Trade detail is reachable from the trades list, not a tab. */}
      <Tabs.Screen name="trade/[id]" options={{ href: null, title: "Trade" }} />
      {/* Phase 25 write-workflow routes — reachable from their parent screens, not tabs. */}
      <Tabs.Screen name="trade/new" options={{ href: null, title: "Add trade" }} />
      <Tabs.Screen name="trade/[id]/close" options={{ href: null, title: "Close trade" }} />
      <Tabs.Screen name="trade/[id]/correct" options={{ href: null, title: "Correct trade" }} />
      <Tabs.Screen name="trade/[id]/review" options={{ href: null, title: "Review trade" }} />
      <Tabs.Screen name="trade/[id]/edit" options={{ href: null, title: "Edit trade" }} />
      <Tabs.Screen name="goal/new" options={{ href: null, title: "New goal" }} />
      <Tabs.Screen name="goal/[id]" options={{ href: null, title: "Goal" }} />
      <Tabs.Screen name="risk" options={{ href: null, title: "Risk & plan" }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: "Notifications" }} />
      {/* M2 correction pass — full-form profile editor, reached from Profile. */}
      <Tabs.Screen name="profile-edit" options={{ href: null, title: "Edit profile" }} />
      {/* Play release — in-app account deletion, reached from Profile. */}
      <Tabs.Screen name="delete-account" options={{ href: null, title: "Delete account" }} />
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/* Floating glass dock (Profile correction pass, Step 4)               */
/*                                                                     */
/* Static layout proof — no overflow at the supported widths.          */
/* The dock is IN FLOW inside a wrapper with 14px page-side            */
/* margins, so the dock box is screen − 28 wide (292 at a 320px        */
/* screen). Border (2) + horizontal padding (12) leave a content       */
/* row of screen − 42, split into 7 equal flex slots (6 tabs + Add):   */
/*   320px → row 278 → slot 39.7px: a tab's content (21px icon,        */
/*     label ≤ ~34px at 10px font) fits its slot; the 54px Add         */
/*     circle overhangs its slot by ~7px per side into the             */
/*     neighbouring slots' slack (their centred content leaves         */
/*     ≥ 9px per side) — no collision, no overflow.                    */
/*   360px → row 318 → slot 45.4px · 390px → row 348 → slot 49.7px ·   */
/*   430px → row 388 → slot 55.4px ≥ 54px (the Add circle fits         */
/*   inside its own slot).                                             */
/* Vertical: the Add circle is translated −36px from the slot top,     */
/* so its centre renders ≈10px above the dock's top edge — mostly      */
/* socketed into the dock (the bg-coloured socket ring sells the       */
/* notch), never detached. The translation is render-only: layout      */
/* stays in-flow, and screens carry ≥ 32px of bottom content           */
/* padding, so no content is ever underlapped or clipped.              */
/* ------------------------------------------------------------------ */

/** The subset of the tab-bar props the dock consumes. */
interface GlassDockProps {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  insets: { top: number; bottom: number; left: number; right: number };
  navigateToTab: (routeKey: string) => void;
}

const DOCK_TABS: {
  route: string;
  label: string;
  icon: IconName;
  iconOutline: IconName;
}[] = [
  { route: "index", label: "Home", icon: "home", iconOutline: "home-outline" },
  {
    route: "trades",
    label: "Trades",
    icon: "swap-horizontal",
    iconOutline: "swap-horizontal",
  },
  {
    route: "analytics",
    label: "Stats",
    icon: "bar-chart",
    iconOutline: "bar-chart-outline",
  },
  { route: "goals", label: "Goals", icon: "flag", iconOutline: "flag-outline" },
  {
    route: "coach",
    label: "Coach",
    icon: "chatbubbles",
    iconOutline: "chatbubbles-outline",
  },
  {
    route: "profile",
    label: "Profile",
    icon: "person",
    iconOutline: "person-outline",
  },
];

function GlassDock({ state, insets, navigateToTab }: GlassDockProps) {
  const router = useRouter();
  const [keyboardUp, setKeyboardUp] = useState(false);

  // tabBarHideOnKeyboard: the custom bar hides itself while a
  // keyboard is up (the navigator option is set as well).
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setKeyboardUp(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (keyboardUp) return null;

  const focusedRouteName = state.routes[state.index]?.name;

  const renderTab = (tab: (typeof DOCK_TABS)[number]) => {
    const route = state.routes.find((r) => r.name === tab.route);
    const focused = focusedRouteName === tab.route;
    // Violet is the AI Coach identity — its active state is
    // the only violet in the dock. Everything else: cyan.
    const activeColor =
      tab.route === "coach" ? tokens.auroraViolet : tokens.cyanBright;
    const color = focused ? activeColor : tokens.textMuted;
    return (
      <Pressable
        key={tab.route}
        accessibilityRole="button"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: focused }}
        disabled={!route}
        onPress={() => {
          if (route) navigateToTab(route.key);
        }}
        style={({ pressed }) => [
          styles.dockTab,
          pressed && { opacity: 0.6 },
        ]}
      >
        <Ionicons
          name={focused ? tab.icon : tab.iconOutline}
          size={21}
          color={color}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.dockTabLabel,
            { color },
            focused && { fontWeight: "700" },
          ]}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.dockOuter,
        { paddingBottom: Math.max(insets.bottom, 0) + 8 },
      ]}
    >
      <LinearGradient
        colors={[
          "rgba(11, 63, 145, 0.55)",
          "rgba(6, 21, 47, 0.88)",
          "rgba(3, 5, 10, 0.94)",
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.dock}
      >
        {/* Bright top-edge light — the glass reflection line. */}
        <View pointerEvents="none" style={styles.dockTopEdge} />
        {DOCK_TABS.slice(0, 3).map(renderTab)}
        <View style={styles.dockAddSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add trade"
            onPress={() => router.push("/(app)/trade/new")}
            style={({ pressed }) => [
              styles.dockAddButton,
              pressed && { opacity: 0.85 },
            ]}
          >
            <LinearGradient
              colors={[tokens.blueBright, tokens.cyanBright]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.dockAddFill}
            >
              <Ionicons name="add" size={30} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>
        {DOCK_TABS.slice(3).map(renderTab)}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  dockOuter: {
    backgroundColor: "transparent",
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  dock: {
    height: 64,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: tokens.glassBorderBright,
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: 6,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  dockTopEdge: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  dockTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 20,
  },
  dockTabLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  dockAddSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  dockAddButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    // Socket ring in the page background colour — the button
    // reads as set INTO the dock, not floating above it.
    borderWidth: 3,
    borderColor: tokens.bg,
    overflow: "hidden",
    transform: [{ translateY: -36 }],
    shadowColor: tokens.cyanBright,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 12,
  },
  dockAddFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
