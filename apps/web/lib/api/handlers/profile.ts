import {
  apiError,
  apiOk,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import { updateProfileCore, uploadAvatarCore } from "@/lib/profile/service";
import {
  checkApiRateLimit,
  coreFailureResponse,
  finish,
  requireApiAuth,
  validateBody,
  type HandlerContext,
} from "./shared";
import type { JsonHandlerInput } from "./trades";

/**
 * Mobile profile handlers (Phase 21, M1): profile update +
 * avatar upload. All logic lives in lib/profile/service.ts
 * — the same cores the web profile actions call.
 */

/** profileEditSchema fields (lib/auth/validation.ts). */
const PROFILE_KEYS = [
  "fullName",
  "fatherName",
  "dateOfBirth",
  "country",
  "tradingExperience",
  "tradingEducation",
  "backtestingExperience",
  "backtestedTrades",
  "realTradingExperience",
  "realTradesCount",
  "demoTrading",
  "employmentStatus",
  "monthlyIncome",
  "tradingCapital",
  "tradesRealMoney",
] as const;

const UPDATE_CTX: HandlerContext = { operation: "profile_updated", entityType: "profiles" };

export async function handleUpdateProfile(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, UPDATE_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return finish(deps, UPDATE_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const validated = validateBody(input.body, PROFILE_KEYS);
  if (!validated.ok) {
    return finish(deps, UPDATE_CTX, userId, "invalid_argument", null, validated.response);
  }
  const limited = checkApiRateLimit(deps, UPDATE_CTX, userId);
  if (limited) {
    return finish(deps, UPDATE_CTX, userId, "rate_limited", null, limited);
  }

  let result: Awaited<ReturnType<typeof updateProfileCore>>;
  try {
    result = await updateProfileCore(supabase, userId, validated.body);
  } catch {
    return finish(deps, UPDATE_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, UPDATE_CTX, userId, outcome, userId, response);
  }
  return finish(deps, UPDATE_CTX, userId, "ok", userId,
    apiOk({ profile: result.profile }));
}

/* ----------------------------------------------------------------- avatar */

const AVATAR_CTX: HandlerContext = { operation: "avatar_updated", entityType: "profiles" };

export interface AvatarHandlerInput {
  token: string | null;
  /** The multipart `file` field, or null when absent/not a file. */
  file: File | null;
}

export async function handleUploadAvatar(
  input: AvatarHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, AVATAR_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  const limited = checkApiRateLimit(deps, AVATAR_CTX, userId);
  if (limited) {
    return finish(deps, AVATAR_CTX, userId, "rate_limited", null, limited);
  }

  let result: Awaited<ReturnType<typeof uploadAvatarCore>>;
  try {
    result = await uploadAvatarCore(supabase, userId, input.file);
  } catch {
    return finish(deps, AVATAR_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, AVATAR_CTX, userId, outcome, userId, response);
  }
  return finish(deps, AVATAR_CTX, userId, "ok", userId,
    apiOk({ avatar_url: result.avatarUrl }));
}
