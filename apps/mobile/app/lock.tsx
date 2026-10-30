import { useState } from "react";
import { Redirect } from "expo-router";
import { Text, View } from "react-native";
import { useAuth } from "../src/auth";
import { GhostButton, LoadingState, PrimaryButton, Screen } from "../src/components";
import { shared } from "../src/theme";

/**
 * Biometric lock screen. Shown on cold start when a session
 * exists and the user enabled the biometric gate. The session
 * itself is untouched — this only gates the UI.
 */
export default function LockScreen() {
  const { session, initializing, lockState, unlock, usePasswordInstead } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (initializing) return <LoadingState label="Restoring your session…" />;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (lockState === "unlocked") return <Redirect href="/(app)" />;

  const onUnlock = async () => {
    setBusy(true);
    const ok = await unlock();
    setBusy(false);
    setFailed(!ok);
  };

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: "center", gap: 16 }}>
        <Text style={shared.title}>ITG TraderOS is locked</Text>
        <Text style={shared.body}>
          Use Face ID or your fingerprint to unlock your trading journal on this
          device.
        </Text>
        {failed ? (
          <Text style={shared.muted}>
            Authentication didn't succeed. Try again, or sign in with your
            password instead.
          </Text>
        ) : null}
        <PrimaryButton
          label={busy ? "Waiting…" : "Unlock"}
          onPress={onUnlock}
          disabled={busy}
        />
        <GhostButton label="Use password instead" onPress={() => void usePasswordInstead()} />
      </View>
    </Screen>
  );
}
