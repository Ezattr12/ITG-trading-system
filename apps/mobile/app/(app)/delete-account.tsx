import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { deleteAccount } from "../../src/api";
import { useAuth } from "../../src/auth";
import { DangerButton, GradientCard, Screen } from "../../src/components";
import { Field, FormError } from "../../src/forms";
import { shared, tokens } from "../../src/theme";

/**
 * Delete account (Google Play release) — the in-app
 * deletion path, reached from Profile.
 *
 * Deletion is permanent and self-service: the trader
 * re-proves ownership with their current password (the
 * server verifies it before anything is removed) and types
 * DELETE to confirm. POST /api/mobile/account/delete does
 * the work server-side; on success the account and its
 * session no longer exist, so this screen clears the local
 * biometric-gate preference and signs out — the (app) shell
 * then returns to the login screen. A wrong password is a
 * 403 and deletes nothing.
 *
 * The two retention exceptions named on this screen are the
 * ones the backend actually implements (and the privacy
 * policy discloses): security audit entries are retained
 * with the account link permanently severed, and backups
 * taken before deletion rotate out on their normal cycle.
 */

// The biometric-gate preference key (src/auth.tsx stores it
// under the same name); cleared here so a deleted account
// leaves no local sign-in preference behind.
const BIOMETRIC_PREF_KEY = "itg.biometric_gate";

export default function DeleteAccountScreen() {
  const { signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    password !== "" && confirmText === "DELETE" && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteAccount(password);
    } catch (err) {
      // The handler's wrong-password answer is a 403 with the
      // generic message "Password is incorrect." — apiFetch
      // throws it verbatim. Every other failure is shown as a
      // generic honest error; nothing was deleted either way.
      const message = err instanceof Error ? err.message : "";
      setError(
        message === "Password is incorrect."
          ? "That password doesn't match. Your account was not deleted."
          : "We couldn't delete your account just now. Nothing was deleted — please try again.",
      );
      setSubmitting(false);
      return;
    }
    // The account no longer exists. Clear the local
    // biometric preference, then sign out so the shell
    // returns to login — never leave this screen showing.
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_PREF_KEY);
    } catch {
      // Best-effort local cleanup; the deletion already succeeded.
    }
    try {
      await signOut();
    } catch {
      // The session is invalid server-side regardless; the
      // shell restores to login on the next auth check.
    }
  }

  return (
    <Screen>
      <Text style={shared.title}>Delete account</Text>
      <Text style={shared.body}>
        Deleting your account is permanent and cannot be undone.
      </Text>

      <GradientCard level="standard">
        <Text style={shared.heading}>What is deleted</Text>
        <Text style={shared.body}>
          Your profile, trading journal, trades, reviews, goals,
          progress and certificates are deleted, along with your
          uploaded profile photo and trade screenshots. Your
          sign-in account is deleted too — you will no longer be
          able to log in.
        </Text>
      </GradientCard>

      <GradientCard level="standard">
        <Text style={shared.heading}>Two exceptions</Text>
        <Text style={shared.body}>
          Security audit entries are kept, with the link to your
          account permanently removed, so the platform's security
          record stays intact without identifying you.
        </Text>
        <Text style={shared.body}>
          Backups taken before you delete rotate out on their
          normal schedule, so a copy may remain in backups for a
          limited time after deletion.
        </Text>
      </GradientCard>

      <View style={styles.form}>
        <Field
          label="Your password"
          hint="Deleting requires your current password, so only you can delete your account."
        >
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoComplete="password"
            autoCorrect={false}
            secureTextEntry
            editable={!submitting}
            style={styles.input}
          />
        </Field>
        <Field
          label="Confirm deletion"
          hint="Type DELETE to confirm this cannot be undone."
        >
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="DELETE"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!submitting}
            style={styles.input}
          />
        </Field>
        <FormError message={error} />
        <DangerButton
          label="Delete my account permanently"
          onPress={() => void onSubmit()}
          disabled={!canSubmit}
          loading={submitting}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 12,
  },
  // Mirrors the login screen's input paint (same tokens).
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
});
