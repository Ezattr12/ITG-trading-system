import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";
import { bootstrapSession } from "./api";
import type { SessionBootstrapResponse } from "./types";

/**
 * Auth/session state for the mobile shell.
 *
 * - The Supabase session itself is persisted by supabase-js in
 *   SecureStore (see the chunked adapter in `supabase.ts`).
 * - After any sign-in (fresh or restored), the profile
 *   bootstrap endpoint is called ONCE per session
 *   (POST /api/mobile/session) so a mobile-first account
 *   always has its `profiles` row before any other call.
 * - Biometric gate: when the device has enrolled biometrics
 *   and the user has enabled the gate (asked once after the
 *   first sign-in), a restored session starts LOCKED and the
 *   app shows the lock screen until `authenticateAsync`
 *   succeeds. Devices without biometrics simply skip the
 *   gate and fall back to the session itself.
 */

const BIOMETRIC_PREF_KEY = "itg.biometric_gate"; // "on" | "off" | unset = not asked yet

export type LockState = "checking" | "locked" | "unlocked";

interface AuthContextValue {
  session: Session | null;
  initializing: boolean;
  bootstrap: SessionBootstrapResponse | null;
  lockState: LockState;
  biometricsAvailable: boolean;
  /** True when no choice has been stored yet — the login screen prompts once. */
  biometricChoicePending: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  unlock: () => Promise<boolean>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  /** Sign out fully so the user can re-authenticate with a password. */
  usePasswordInstead: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function detectBiometrics(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [bootstrap, setBootstrap] = useState<SessionBootstrapResponse | null>(null);
  const [lockState, setLockState] = useState<LockState>("checking");
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricChoicePending, setBiometricChoicePending] = useState(false);
  const bootstrappedFor = useRef<string | null>(null);

  const runBootstrap = useCallback(async (sess: Session) => {
    if (bootstrappedFor.current === sess.user.id) return;
    bootstrappedFor.current = sess.user.id;
    try {
      const result = await bootstrapSession();
      setBootstrap(result);
    } catch {
      // Bootstrap is retried on the next auth event; screens that
      // need the profile read it under RLS and show honest states.
      bootstrappedFor.current = null;
    }
  }, []);

  const applyGate = useCallback(async (sess: Session | null, freshSignIn: boolean) => {
    if (!sess) {
      setLockState("unlocked");
      return;
    }
    const available = await detectBiometrics();
    setBiometricsAvailable(available);
    if (!available) {
      setLockState("unlocked");
      return;
    }
    const pref = await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY);
    if (pref === null) {
      // Not asked yet: a fresh sign-in unlocks (the login screen
      // will prompt); a cold-start restore also unlocks this once
      // so the user is never locked out before choosing.
      setBiometricChoicePending(true);
      setLockState("unlocked");
      return;
    }
    if (pref === "on" && !freshSignIn) {
      setLockState("locked");
    } else {
      setLockState("unlocked");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(async ({ data: { session: restored } }) => {
        if (!mounted) return;
        setSession(restored);
        if (restored) {
          await runBootstrap(restored);
          await applyGate(restored, false);
        } else {
          setLockState("unlocked");
        }
        setInitializing(false);
      })
      .catch(() => {
        if (mounted) {
          setInitializing(false);
          setLockState("unlocked");
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, next) => {
      setSession(next);
      if (next && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
        await runBootstrap(next);
        if (event === "SIGNED_IN") await applyGate(next, true);
      }
      if (!next) {
        setBootstrap(null);
        bootstrappedFor.current = null;
        setLockState("unlocked");
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [applyGate, runBootstrap]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    if (data.session) {
      await runBootstrap(data.session);
      await applyGate(data.session, true);
    }
  }, [applyGate, runBootstrap]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setBootstrap(null);
    bootstrappedFor.current = null;
    setLockState("unlocked");
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock ITG TraderOS",
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });
    if (result.success) {
      setLockState("unlocked");
      return true;
    }
    return false;
  }, []);

  const setBiometricEnabled = useCallback(async (enabled: boolean) => {
    await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, enabled ? "on" : "off");
    setBiometricChoicePending(false);
  }, []);

  const usePasswordInstead = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      initializing,
      bootstrap,
      lockState,
      biometricsAvailable,
      biometricChoicePending,
      signIn,
      signOut,
      unlock,
      setBiometricEnabled,
      usePasswordInstead,
    }),
    [
      session,
      initializing,
      bootstrap,
      lockState,
      biometricsAvailable,
      biometricChoicePending,
      signIn,
      signOut,
      unlock,
      setBiometricEnabled,
      usePasswordInstead,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}
