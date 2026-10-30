import "react-native-url-polyfill/auto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

/**
 * Supabase client for the mobile shell.
 *
 * Session persistence: supabase-js stores the whole session
 * (access + refresh token) as one JSON value, which routinely
 * exceeds SecureStore's ~2048-byte per-value limit. The adapter
 * below therefore CHUNKS the value: it is split into slices of
 * CHUNK_SIZE characters stored under `<key>.chunk.<n>`, with the
 * chunk count under `<key>.chunks`. Reads reassemble the slices;
 * writes first clear any stale slices from a previously longer
 * value so a shorter session can never resurrect old bytes.
 *
 * Only the PUBLIC anon key is used here (from EXPO_PUBLIC_*
 * env). Row Level Security — not key secrecy — is what protects
 * trader data, exactly as in the web app's browser client.
 */

const CHUNK_SIZE = 1800; // safely under SecureStore's 2048-byte value limit

async function clearChunks(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${key}.chunks`);
  const count = countRaw ? Number.parseInt(countRaw, 10) : 0;
  if (Number.isFinite(count) && count > 0) {
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.deleteItemAsync(`${key}.chunk.${i}`),
      ),
    );
  }
  await SecureStore.deleteItemAsync(`${key}.chunks`);
}

export const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(`${key}.chunks`);
    if (!countRaw) {
      // Legacy / small value stored unchunked.
      return SecureStore.getItemAsync(key);
    }
    const count = Number.parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.chunk.${i}`),
      ),
    );
    if (parts.some((p) => p === null)) return null;
    return parts.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    await clearChunks(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    await SecureStore.deleteItemAsync(key);
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(
        `${key}.chunk.${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    await SecureStore.setItemAsync(`${key}.chunks`, String(count));
  },

  async removeItem(key: string): Promise<void> {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://pwzvthvvxyfppenmessf.supabase.co";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
