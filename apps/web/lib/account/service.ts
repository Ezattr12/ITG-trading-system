import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Account deletion core (Google Play release preparation).
 *
 * ONE deletion path for every surface — the trader's own
 * in-app request (web action, mobile handler) and an admin
 * processing an external deletion request all end here:
 *
 *   1. Storage first. Bucket objects do NOT cascade when the
 *      auth user is deleted, so the trader's trade
 *      screenshots (private bucket) and avatar objects
 *      (public bucket) are removed explicitly, BEFORE the
 *      auth delete, while the rows that name them still
 *      exist. Storage removal is best-effort: a failure is
 *      counted and flagged in the returned summary, never
 *      silently swallowed, and never blocks the deletion
 *      itself — a leftover object under a deleted user's
 *      prefix is inert, while a surviving account the
 *      trader asked to delete is not.
 *   2. `auth.admin.deleteUser` then removes the auth user;
 *      `profiles.id → auth.users(id) ON DELETE CASCADE`
 *      and every user table's FK to profiles cascade with
 *      it, so all of the trader's rows go in one step.
 *      The disclosed exception is `audit_logs`: its
 *      user_id / actor_id are ON DELETE SET NULL, so audit
 *      rows are RETAINED with the user link severed
 *      (security/audit retention, stated in the Privacy
 *      Policy).
 *
 * The caller MUST have established identity and authority
 * before calling: the trader's own surfaces re-verify the
 * account password first; the admin surface is gated by
 * requireAdmin. This core trusts the userId it is given,
 * exactly like the other service cores — it is only ever
 * called with a session/token-derived or admin-looked-up
 * id, never a client-supplied one.
 */

export interface DeleteAccountSummary {
  screenshotsRemoved: number;
  avatarsRemoved: number;
  /** True when any storage read/removal failed (best-effort step). */
  storageError: boolean;
}

const SCREENSHOT_PAGE = 1000;
const AVATAR_LIST_LIMIT = 100;

export async function deleteAccountCore(
  admin: SupabaseClient,
  userId: string,
): Promise<DeleteAccountSummary> {
  let storageError = false;

  /* ------------------------------------------------ screenshots */
  const screenshotPaths: string[] = [];
  for (let from = 0; ; from += SCREENSHOT_PAGE) {
    const { data, error } = await admin
      .from("trade_screenshots")
      .select("storage_path")
      .eq("user_id", userId)
      .range(from, from + SCREENSHOT_PAGE - 1);
    if (error) {
      storageError = true;
      break;
    }
    const rows = (data ?? []) as { storage_path: string }[];
    for (const row of rows) {
      if (row.storage_path) screenshotPaths.push(row.storage_path);
    }
    if (rows.length < SCREENSHOT_PAGE) break;
  }
  let screenshotsRemoved = 0;
  if (screenshotPaths.length > 0) {
    const { data, error } = await admin.storage
      .from("trade-screenshots")
      .remove(screenshotPaths);
    if (error) {
      storageError = true;
    } else {
      screenshotsRemoved = data?.length ?? 0;
    }
  }

  /* ----------------------------------------------------- avatars */
  // Avatar uploads live flat under the `<userId>/` prefix
  // (`{userId}/avatar-{ts}.{ext}`, one live object per user
  // in practice); list one page of up to 100 and remove all.
  const avatarPaths: string[] = [];
  const { data: avatarFiles, error: listError } = await admin.storage
    .from("avatars")
    .list(userId, { limit: AVATAR_LIST_LIMIT, offset: 0 });
  if (listError) {
    storageError = true;
  } else {
    for (const file of avatarFiles ?? []) {
      if (file.name) avatarPaths.push(`${userId}/${file.name}`);
    }
  }
  let avatarsRemoved = 0;
  if (avatarPaths.length > 0) {
    const { data, error } = await admin.storage.from("avatars").remove(avatarPaths);
    if (error) {
      storageError = true;
    } else {
      avatarsRemoved = data?.length ?? 0;
    }
  }

  /* --------------------------------------------- the auth delete */
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    throw new Error(`Account deletion failed: ${deleteError.message}`);
  }

  return { screenshotsRemoved, avatarsRemoved, storageError };
}

/**
 * Re-verify an account password before a destructive action.
 * Uses a throwaway anon client (no session persistence) so
 * the caller's own session — cookie or token — is never
 * touched. Returns a plain boolean: wrong password, unknown
 * email and unconfigured auth are indistinguishable `false`.
 */
export async function verifyUserPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) return false;
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return false;
  await client.auth.signOut().catch(() => undefined);
  return true;
}

/**
 * Record an external (signed-out) account-deletion request.
 * Returns true when a pending request for the email exists
 * after the call — including when it already existed: the
 * partial unique index rejects the duplicate insert
 * (Postgres 23505) and that conflict is SUCCESS here, so
 * the public form's response can stay perfectly uniform
 * and never oracle whether an email is registered or
 * already has a request pending.
 */
export async function requestAccountDeletion(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return false;
  const { error } = await admin
    .from("account_deletion_requests")
    .insert({ email: normalized, source: "web" });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return true;
  return false;
}
