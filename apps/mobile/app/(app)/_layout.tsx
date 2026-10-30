import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../src/auth";
import { LoadingState } from "../../src/components";
import { tokens } from "../../src/theme";

/**
 * Signed-in tab shell. Guards: no session → login; biometric
 * gate locked → lock screen. Tabs follow the web app's primary
 * navigation (Dashboard, Trades, Analytics, Goals) plus Coach
 * and Profile.
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
      screenOptions={{
        headerStyle: { backgroundColor: tokens.bg },
        headerTitleStyle: { color: tokens.textPrimary },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: tokens.bgDeep,
          borderTopColor: tokens.glassBorder,
        },
        tabBarActiveTintColor: tokens.auroraViolet,
        tabBarInactiveTintColor: tokens.textMuted,
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
    </Tabs>
  );
}
