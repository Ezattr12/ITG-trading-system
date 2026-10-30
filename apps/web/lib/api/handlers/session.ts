import {
  apiError,
  apiOk,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import {
  ensureProfileCore,
  ProfileBootstrapError,
} from "@/lib/profile/service";
import {
  checkApiRateLimit,
  finish,
  requireApiAuth,
  validateBody,
  type HandlerContext,
} from "./shared";
import type { JsonHandlerInput } from "./trades";

/**
 * Mobile session bootstrap (Phase 21, M2) — the endpoint
 * that closes the M1 profile-less finding
 * (docs/phase-21-m1.md).
 *
 * A mobile-first identity can hold a valid Supabase account
 * without ever entering the web app, so it may have no
 * `profiles` row — and every FK that points at profiles
 * (trades, audit_logs, …) then rejects its writes. This
 * handler runs the exact first-login profile creation the
 * web uses (`ensureProfileCore`, extracted from
 * `getCurrentUser`) under the caller's token-scoped RLS
 * client: identity from the validated token only, insert
 * payload exactly `{ id, full_name from auth metadata }`.
 *
 * Idempotent: an existing profile returns `created: false`
 * and nothing is inserted (a repeat call is a no-op read).
 * A genuine creation failure is a DISTINCT, client-
 * actionable error (`422 profile_bootstrap_failed`) so the
 * app can surface "setup could not finish" instead of the
 * generic save failures the FK used to produce.
 *
 * Audit ordering matters: the `api.mobile.session_bootstrap`
 * row is written by `finish` AFTER the bootstrap, so for a
 * first-time user the profile row exists and the audit
 * insert satisfies its FK — bootstrapped users are auditable
 * from their very first call. (The unauthenticated exit is
 * audited with a null actor inside requireApiAuth, as
 * everywhere in this API.)
 */

const SESSION_CTX: HandlerContext = {
  operation: "session_bootstrap",
  entityType: "profiles",
};

/** No body keys are accepted — identity comes from the token. */
const SESSION_KEYS: readonly string[] = [];

export async function handleSessionBootstrap(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, SESSION_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase, user } = gate.auth;

  if (input.bodyError) {
    return finish(deps, SESSION_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  // The body is optional for this endpoint (the route's
  // lenient parse turns a bodiless POST into {}), but when a
  // body IS sent it must carry nothing at all — any key is
  // either a smuggled identity field or unknown.
  const validated = validateBody(input.body ?? {}, SESSION_KEYS);
  if (!validated.ok) {
    return finish(deps, SESSION_CTX, userId, "invalid_argument", null, validated.response);
  }
  const limited = checkApiRateLimit(deps, SESSION_CTX, userId);
  if (limited) {
    return finish(deps, SESSION_CTX, userId, "rate_limited", null, limited);
  }

  let created: boolean;
  try {
    const ensured = await ensureProfileCore(supabase, user);
    if (!ensured.profile) throw new ProfileBootstrapError();
    created = ensured.created;
  } catch (e) {
    if (e instanceof ProfileBootstrapError) {
      return finish(deps, SESSION_CTX, userId, "profile_bootstrap_failed", userId,
        apiError(
          422,
          "profile_bootstrap_failed",
          "We could not finish setting up your profile. Please try again.",
        ));
    }
    return finish(deps, SESSION_CTX, userId, "error", null, apiError(500, "internal"));
  }

  const { data: onboarding } = await supabase
    .from("onboarding_profiles")
    .select("is_complete")
    .eq("user_id", userId)
    .maybeSingle();
  const onboardingComplete = Boolean(
    (onboarding as { is_complete?: boolean } | null)?.is_complete,
  );

  return finish(deps, SESSION_CTX, userId, "ok", userId,
    apiOk({
      profile_id: userId,
      created,
      onboarding_complete: onboardingComplete,
    }));
}
