import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import type { ProfileRow } from "@/lib/auth/session";
import {
  checkPresetRateLimit,
  rateLimitMessage,
  UPLOAD_RATE_LIMIT,
} from "@/lib/auth/rate-limit";
import { firstZodError, profileEditSchema } from "@/lib/auth/validation";
import { avatarFileError } from "./avatar-validation";
import type { CoreFailure } from "@/lib/trades/service";

/**
 * Profile service cores (Phase 21, M1) — the single source
 * of truth for the profile write operations, extracted
 * verbatim from lib/auth/actions.ts. The web actions are
 * now adapters (session + FormData); the mobile API
 * handlers call the same cores with the token-derived
 * user id. Validation, storage path scheme, messages and
 * audit behaviour are unchanged.
 *
 * CoreFailure codes are shared with lib/trades/service.ts:
 * `invalid_input | rate_limited | not_found | business |
 * save_failed` (see that module for the mapping contract).
 */

/* ------------------------------------------------------- session bootstrap */

/** Thrown when a first-login profile cannot be created for a real reason. */
export class ProfileBootstrapError extends Error {
  constructor(message = "Profile bootstrap failed.") {
    super(message);
    this.name = "ProfileBootstrapError";
  }
}

export interface EnsureProfileResult {
  profile: ProfileRow | null;
  /** True only when this call inserted the row. */
  created: boolean;
}

/**
 * Ensure the trader's `profiles` row exists (Phase 21, M2) —
 * the single home of the first-login profile creation that
 * used to live inline in `getCurrentUser` (lib/auth/session).
 * The insert runs under the caller's RLS client (the web
 * session client, or the mobile token client) and carries
 * exactly `{ id, full_name }` — the name from the auth
 * metadata, never from request input.
 *
 * Idempotent: an existing row is returned with
 * `created: false` and nothing is inserted. Race-safe: if a
 * concurrent first login wins the insert (unique violation),
 * the row is re-read and returned with `created: false`.
 * Any other insert failure throws `ProfileBootstrapError`
 * so API callers can answer a distinct, client-actionable
 * error; `getCurrentUser` catches it and keeps its historic
 * null-profile outcome.
 */
export async function ensureProfileCore(
  supabase: SupabaseClient,
  user: { id: string; user_metadata?: Record<string, unknown> | null },
): Promise<EnsureProfileResult> {
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) {
    return { profile: existing as ProfileRow, created: false };
  }
  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      full_name: (user.user_metadata?.full_name as string | null) ?? null,
    })
    .select("*")
    .single();
  if (!error && created) {
    return { profile: created as ProfileRow, created: true };
  }
  if (error && error.code === "23505") {
    // A concurrent first login inserted first — re-read and
    // report the row as pre-existing.
    const { data: raced } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (raced) return { profile: raced as ProfileRow, created: false };
  }
  throw new ProfileBootstrapError();
}

/* ------------------------------------------------------------ profile edit */

export interface UpdatedProfile {
  id: string;
  full_name: string;
  father_name: string | null;
  date_of_birth: string | null;
  country: string | null;
  trading_experience: string | null;
  trading_education: string | null;
  backtesting_experience: boolean;
  backtested_trades: number | null;
  real_trading_experience: boolean;
  real_trades_count: number | null;
  demo_trading: boolean;
  employment_status: string;
  monthly_income: number | null;
  trading_capital: number | null;
  trades_real_money: boolean;
}

export type UpdateProfileCoreResult =
  | { ok: true; profile: UpdatedProfile }
  | CoreFailure;

export async function updateProfileCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<UpdateProfileCoreResult> {
  const parsed = profileEditSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: "invalid_input", error: firstZodError(parsed.error) };
  }
  const v = parsed.data;
  const update = {
    full_name: v.fullName,
    father_name: v.fatherName,
    date_of_birth: v.dateOfBirth,
    country: v.country,
    trading_experience: v.tradingExperience,
    trading_education: v.tradingEducation,
    backtesting_experience: v.backtestingExperience,
    backtested_trades: v.backtestedTrades,
    real_trading_experience: v.realTradingExperience,
    real_trades_count: v.realTradesCount,
    demo_trading: v.demoTrading,
    employment_status: v.employmentStatus,
    monthly_income: v.monthlyIncome,
    trading_capital: v.tradingCapital,
    trades_real_money: v.tradesRealMoney,
  };
  const { error } = await supabase.from("profiles").update(update).eq("id", userId);
  if (error) {
    return { ok: false, code: "save_failed", error: "Could not save your profile. Please try again." };
  }
  await writeAuditLog({ userId, action: "profile.updated", entityType: "profiles", entityId: userId });
  return {
    ok: true,
    profile: {
      ...update,
      id: userId,
      father_name: update.father_name ?? null,
      date_of_birth: update.date_of_birth ?? null,
      country: update.country ?? null,
      trading_experience: update.trading_experience ?? null,
      trading_education: update.trading_education ?? null,
      backtested_trades: update.backtested_trades ?? null,
      real_trades_count: update.real_trades_count ?? null,
      monthly_income: update.monthly_income ?? null,
      trading_capital: update.trading_capital ?? null,
    },
  };
}

/* ----------------------------------------------------------------- avatar */

/**
 * Avatar upload core — real Supabase Storage, honest errors.
 * No fake upload, no local placeholder image presented as a
 * photo. Requires a Storage bucket named `avatars` (created
 * as part of Supabase setup, Phase 13). Max 2 MB, images
 * only (shared rules in lib/profile/avatar-validation.ts).
 * Storage path scheme is unchanged: `{userId}/avatar-{ts}.{ext}`.
 */
export type UploadAvatarCoreResult =
  | { ok: true; avatarUrl: string }
  | CoreFailure;

export async function uploadAvatarCore(
  supabase: SupabaseClient,
  userId: string,
  file: File | null,
): Promise<UploadAvatarCoreResult> {
  const fileError = avatarFileError(file);
  if (fileError) return { ok: false, code: "invalid_input", error: fileError };
  if (!file) return { ok: false, code: "invalid_input", error: "Choose an image file first." };
  // Rate limit (Phase 11): at most 10 uploads per 10 minutes per trader.
  const uploadRate = checkPresetRateLimit(`upload:${userId}`, UPLOAD_RATE_LIMIT);
  if (!uploadRate.allowed) {
    return { ok: false, code: "rate_limited", error: rateLimitMessage("photo upload", uploadRate) };
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) {
    return {
      ok: false,
      code: "save_failed",
      error:
        "Photo upload failed — the 'avatars' Storage bucket may not exist yet in this Supabase project. Ask an admin to create it, then try again.",
    };
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", userId);
  if (updateError) {
    return {
      ok: false,
      code: "save_failed",
      error: "Photo uploaded but the profile could not be updated. Please try again.",
    };
  }
  return { ok: true, avatarUrl: publicUrl };
}
