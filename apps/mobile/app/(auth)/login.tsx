import { useEffect, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/auth";
import { GhostButton, PrimaryButton, Screen } from "../../src/components";
import { shared, tokens } from "../../src/theme";

/**
 * Email/password sign-in against the same Supabase project as
 * the web app. On success the auth provider runs the session
 * bootstrap (POST /api/mobile/session); if biometrics are
 * available and the user hasn't chosen yet, we ask once whether
 * to enable the biometric gate.
 */
export default function LoginScreen() {
  const router = useRouter();
  const {
    session,
    initializing,
    signIn,
    biometricsAvailable,
    biometricChoicePending,
    setBiometricEnabled,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompted, setPrompted] = useState(false);

  useEffect(() => {
    if (session && biometricsAvailable && biometricChoicePending && !prompted) {
      setPrompted(true);
      Alert.alert(
        "Biometric unlock",
        "Use Face ID or your fingerprint to unlock ITG TraderOS on this device?",
        [
          {
            text: "Not now",
            style: "cancel",
            onPress: () => void setBiometricEnabled(false),
          },
          {
            text: "Enable",
            onPress: () => void setBiometricEnabled(true),
          },
        ],
      );
    }
  }, [session, biometricsAvailable, biometricChoicePending, prompted, setBiometricEnabled]);

  if (!initializing && session) return <Redirect href="/(app)" />;

  const onSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace("/(app)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: 4, marginTop: 24 }}>
        <Text style={shared.title}>ITG TraderOS</Text>
        <Text style={shared.muted}>
          Institutional Trading Group — sign in with your TraderOS account.
        </Text>
      </View>

      <View style={styles.form}>
        <Text style={shared.label}>Email</Text>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={tokens.textMuted}
          style={styles.input}
          value={email}
        />
        <Text style={shared.label}>Password</Text>
        <TextInput
          accessibilityLabel="Password"
          autoComplete="password"
          onChangeText={setPassword}
          placeholder="Your password"
          placeholderTextColor={tokens.textMuted}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label={busy ? "Signing in…" : "Sign in"}
          onPress={onSubmit}
          disabled={busy || email.trim() === "" || password === ""}
        />
        <GhostButton
          label="Create an account on the web app"
          onPress={() =>
            Alert.alert(
              "Create your account",
              "Accounts are created in the ITG TraderOS web app. Sign up there once, then sign in here with the same email and password.",
            )
          }
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 10,
    marginTop: 12,
  },
  input: {
    backgroundColor: tokens.glass,
    borderColor: tokens.glassBorder,
    borderWidth: 1,
    borderRadius: tokens.radiusSm,
    color: tokens.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  error: {
    color: tokens.loss,
    fontSize: 13,
    lineHeight: 18,
  },
});
