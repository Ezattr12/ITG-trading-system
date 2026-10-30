import {
  apiError,
  apiOk,
  IDENTITY_FIELDS,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import { getReportSummary } from "@/lib/reports/queries";
import { weekBounds } from "@/lib/reviews/reviews";
import {
  checkApiRateLimit,
  finish,
  requireApiAuth,
  type HandlerContext,
} from "./shared";

/**
 * Mobile summary read (Phase 21, M2) — the ONE read
 * endpoint of the mobile API, and the only one justified:
 * lists and details are served by direct Supabase reads
 * under RLS from the app (see docs/phase-21-m2.md for the
 * evaluation), but the dashboard/analytics aggregates are a
 * trusted server computation (`getReportSummary`,
 * lib/reports/queries.ts) that the client cannot reproduce
 * from raw rows without duplicating the report engine.
 *
 * `GET /api/mobile/summary?range=week|month` (default
 * week): the current week (Mon–Sun UTC) or the current
 * calendar month, computed with the caller's token client —
 * identity from the token only; an identity query parameter
 * is a 400 naming it. One `api.mobile.summary_read` audit
 * row per call, like every endpoint in this API.
 */

const SUMMARY_CTX: HandlerContext = { operation: "summary_read", entityType: "reports" };

export interface SummaryReadInput {
  token: string | null;
  /** The raw `range` query parameter, or null when absent. */
  rangeParam: string | null;
  /** All query parameter names present on the request. */
  queryKeys: string[];
}

export async function handleSummaryRead(
  input: SummaryReadInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, SUMMARY_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  for (const key of input.queryKeys) {
    if ((IDENTITY_FIELDS as readonly string[]).includes(key)) {
      return finish(deps, SUMMARY_CTX, userId, "invalid_argument", null,
        apiError(
          400,
          "invalid_argument",
          `identity field not allowed: ${key} — the trader is identified by the access token`,
        ));
    }
  }
  const range = input.rangeParam ?? "week";
  if (range !== "week" && range !== "month") {
    return finish(deps, SUMMARY_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", `invalid range '${range}' — use 'week' or 'month'`));
  }
  const limited = checkApiRateLimit(deps, SUMMARY_CTX, userId);
  if (limited) {
    return finish(deps, SUMMARY_CTX, userId, "rate_limited", null, limited);
  }

  const today = deps.now().toISOString().slice(0, 10);
  let periodStart: string;
  let periodEnd: string;
  if (range === "week") {
    const bounds = weekBounds(today);
    if (!bounds) {
      return finish(deps, SUMMARY_CTX, userId, "error", null, apiError(500, "internal"));
    }
    periodStart = bounds.start;
    periodEnd = bounds.end;
  } else {
    const [year, month] = today.split("-").map(Number);
    periodStart = `${today.slice(0, 7)}-01`;
    periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }

  let summary: Awaited<ReturnType<typeof getReportSummary>>;
  try {
    summary = await getReportSummary(supabase, userId, {
      type: range === "week" ? "weekly" : "monthly",
      periodStart,
      periodEnd,
    });
  } catch {
    return finish(deps, SUMMARY_CTX, userId, "error", null, apiError(500, "internal"));
  }
  return finish(deps, SUMMARY_CTX, userId, "ok", null,
    apiOk({
      range,
      period_start: periodStart,
      period_end: periodEnd,
      summary,
    }));
}
