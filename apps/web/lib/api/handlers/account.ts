import {
  apiError,
  apiOk,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import { deleteAccountCore, verifyUserPassword } from "@/lib/account/service";
import {
  checkApiRateLimit,
  finish,
  requireApiAuth,
  validateBody,
  type HandlerContext,
} from "./shared";
import type { JsonHandlerInput } from "./trades";

/**
 * Mobile self-service account deletion (Google Play release
 * preparation), on the M1 pipeline. The body carries ONLY
 * `{ password }` — the trader re-proves account ownership
 * with their current password, then `deleteAccountCore`
 * removes their storage objects and the auth user (every
 * user row cascades; audit rows are retained with the user
 * link severed, as disclosed).
 *
 * A wrong password is a 403 with a generic message and NO
 * deletion. A correct one deletes the account behind the
 * very token that authorised the call, so the success
 * response is the last thing this account ever receives.
 * The pipeline's single `api.mobile.account_delete` audit
 * row is written BEFORE the response returns — the write
 * goes through the service role, and after the cascade the
 * row remains with its user_id set null by the FK, exactly
 * as designed.
 */

const ACCOUNT_DELETE_KEYS = ["password"] as const;

const ACCOUNT_DELETE_CTX: HandlerContext = {
  operation: "account_delete",
  entityType: "account",
};

export async function handleDeleteAccount(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, ACCOUNT_DELETE_CTX);
  if (!gate.ok) return gate.response;
  const { userId, user } = gate.auth;

  if (input.bodyError) {
    return finish(deps, ACCOUNT_DELETE_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const validated = validateBody(input.body, ACCOUNT_DELETE_KEYS);
  if (!validated.ok) {
    return finish(deps, ACCOUNT_DELETE_CTX, userId, "invalid_argument", null, validated.response);
  }
  const password = validated.body.password;
  if (typeof password !== "string" || password === "") {
    return finish(deps, ACCOUNT_DELETE_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "'password' is required"));
  }
  const limited = checkApiRateLimit(deps, ACCOUNT_DELETE_CTX, userId);
  if (limited) {
    return finish(deps, ACCOUNT_DELETE_CTX, userId, "rate_limited", null, limited);
  }

  const email = user.email ?? "";
  const passwordOk = email !== "" && (await verifyUserPassword(email, password));
  if (!passwordOk) {
    return finish(deps, ACCOUNT_DELETE_CTX, userId, "forbidden", null,
      apiError(403, "forbidden", "Password is incorrect."));
  }

  const admin = deps.makeAdminClient();
  if (!admin) {
    return finish(deps, ACCOUNT_DELETE_CTX, userId, "error", null, apiError(500, "internal"));
  }
  // The success path cannot use `finish`: its audit row must
  // be written BEFORE the core deletes the auth user. The
  // row names this user, and `audit_logs.user_id` is a real
  // FK — a post-delete insert would be rejected outright,
  // while a pre-delete insert is retained by the cascade
  // with the user link severed (ON DELETE SET NULL), which
  // is exactly the disclosed audit-retention behaviour. The
  // exactly-one-row rule still holds: every other exit goes
  // through `finish`, this exit writes its one row here.
  await deps.auditApi({
    userId,
    operation: ACCOUNT_DELETE_CTX.operation,
    entityType: ACCOUNT_DELETE_CTX.entityType,
    entityId: null,
    outcome: "ok",
  });
  try {
    await deleteAccountCore(admin, userId);
  } catch {
    return apiError(500, "internal");
  }
  return apiOk({ deleted: true });
}
