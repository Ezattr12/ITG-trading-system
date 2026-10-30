import { Redirect } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../src/auth";
import { LoadingState } from "../src/components";
import { tokens } from "../src/theme";

/** Entry route: route to the app, the lock screen, or login based on session state. */
export default function Index() {
  const { session, initializing, lockState } = useAuth();

  if (initializing || lockState === "checking") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.bg }}>
        <LoadingState label="Restoring your session…" />
      </View>
    );
  }
  if (!session) return <Redirect href="/(auth)/login" />;
  if (lockState === "locked") return <Redirect href="/lock" />;
  return <Redirect href="/(app)" />;
}
