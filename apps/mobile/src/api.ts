import { supabase } from "./supabase";
import type {
  AdvancedReviewPayload,
  BacktestingResponse,
  CancelTradeResponse,
  CoachChatAnswer,
  CoachChatHistoryTurn,
  CorrectTradeResponse,
  CreateGoalResponse,
  CreateTradeResponse,
  GoalCreatePayload,
  GoalProgressPayload,
  MarkReadResponse,
  QuickTradePayload,
  RiskRulesPayload,
  SessionBootstrapResponse,
  SummaryRange,
  SummaryResponse,
  TradingPlanPayload,
  UploadScreenshotResponse,
  WeeklyReviewPayload,
  WeeklyReviewResponse,
} from "./types";

/**
 * Client for the authenticated /api/mobile/* endpoints on the
 * web app (Phase 21 M1/M2). Every call sends the CURRENT
 * Supabase access token; identity is derived server-side from
 * that token — the client never sends any user/profile id.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://itg-traderos.vercel.app";

async function accessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.message) message = body.message;
      else if (body.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/**
 * POST /api/mobile/session — idempotent profile bootstrap.
 * Called once after sign-in: creates the caller's `profiles`
 * row via the web's own profile-creation path when missing
 * (closing the profile-less gap a mobile-first signup would
 * otherwise hit) and reports onboarding state.
 */
export async function bootstrapSession(): Promise<SessionBootstrapResponse> {
  return apiFetch<SessionBootstrapResponse>("/api/mobile/session", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** GET /api/mobile/summary?range=week|month — server-computed report aggregates. */
export async function fetchSummary(range: SummaryRange): Promise<SummaryResponse> {
  return apiFetch<SummaryResponse>(`/api/mobile/summary?range=${range}`);
}

/* ---------------- Phase 25 write workflows ----------------
 *
 * One helper per /api/mobile write endpoint (Phase 21 M1/M2).
 * Each sends the session Bearer token via apiFetch; bodies are
 * exactly the web schema fields — never an identity field
 * (the API rejects user_id / tenant_id / profile_id / userId
 * with a 400 naming the field). Server error messages are
 * thrown verbatim so forms can show them unchanged.
 */

/** POST /api/mobile/trades — quick trade create; P&L/R/ROI are computed by the server core. */
export async function createTrade(
  payload: QuickTradePayload,
): Promise<CreateTradeResponse> {
  return apiFetch<CreateTradeResponse>("/api/mobile/trades", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/mobile/trades/[id]/correct — correction by
 * reversal: creates the corrected trade and marks the
 * original reversed. This is also the close path for an OPEN
 * trade (the only one the product has — same as web).
 */
export async function correctTrade(
  tradeId: string,
  payload: QuickTradePayload,
): Promise<CorrectTradeResponse> {
  return apiFetch<CorrectTradeResponse>(`/api/mobile/trades/${tradeId}/correct`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** POST /api/mobile/trades/[id]/cancel — voids an OPEN trade; the body must be empty. */
export async function cancelTrade(tradeId: string): Promise<CancelTradeResponse> {
  return apiFetch<CancelTradeResponse>(`/api/mobile/trades/${tradeId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** POST /api/mobile/trades/[id]/review — FULL-FORM advanced review save (journal + psychology). */
export async function saveTradeReview(
  tradeId: string,
  payload: AdvancedReviewPayload,
): Promise<{ trade_id: string }> {
  return apiFetch<{ trade_id: string }>(`/api/mobile/trades/${tradeId}/review`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/mobile/trades/[id]/screenshots — multipart upload,
 * field name `file` (the route reads exactly that field). No
 * JSON Content-Type: fetch sets the multipart boundary itself.
 */
export async function uploadScreenshot(
  tradeId: string,
  asset: { uri: string; name: string; type: string },
): Promise<UploadScreenshotResponse> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  const form = new FormData();
  form.append("file", {
    uri: asset.uri,
    name: asset.name,
    type: asset.type,
    // React Native's FormData accepts this object shape for files.
  } as unknown as Blob);
  const res = await fetch(`${API_BASE_URL}/api/mobile/trades/${tradeId}/screenshots`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.message) message = body.message;
      else if (body.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new Error(message);
  }
  return (await res.json()) as UploadScreenshotResponse;
}

/** DELETE /api/mobile/trades/[id]/screenshots/[screenshotId] — removes row + storage object. */
export async function deleteScreenshot(
  tradeId: string,
  screenshotId: string,
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(
    `/api/mobile/trades/${tradeId}/screenshots/${screenshotId}`,
    { method: "DELETE" },
  );
}

/** POST /api/mobile/goals — create a goal. */
export async function createGoal(
  payload: GoalCreatePayload,
): Promise<CreateGoalResponse> {
  return apiFetch<CreateGoalResponse>("/api/mobile/goals", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** POST /api/mobile/goals/[id]/progress — record today's progress value. */
export async function recordGoalProgress(
  goalId: string,
  payload: GoalProgressPayload,
): Promise<{ goal_id: string; current_value: number }> {
  return apiFetch<{ goal_id: string; current_value: number }>(
    `/api/mobile/goals/${goalId}/progress`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

/**
 * PATCH /api/mobile/goals/[id] — the only goal edit the API
 * exposes: { status } (goalStatusSchema). Completing a goal
 * runs the gamification side of the core (+20 XP, server-side).
 */
export async function updateGoalStatus(
  goalId: string,
  status: "active" | "completed" | "paused" | "failed",
): Promise<{ goal_id: string; status: string }> {
  return apiFetch<{ goal_id: string; status: string }>(`/api/mobile/goals/${goalId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/** PUT /api/mobile/risk-rules — full-form save of the active risk rules (blank = no limit). */
export async function saveRiskRules(
  payload: RiskRulesPayload,
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/mobile/risk-rules", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** PUT /api/mobile/risk-plan — full-form save of the active trading plan. */
export async function saveTradingPlan(
  payload: TradingPlanPayload,
): Promise<{ plan_id: string }> {
  return apiFetch<{ plan_id: string }>("/api/mobile/risk-plan", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** POST /api/mobile/reviews/weekly — save the weekly review; +30 XP once per week (server-side). */
export async function saveWeeklyReview(
  payload: WeeklyReviewPayload,
): Promise<WeeklyReviewResponse> {
  return apiFetch<WeeklyReviewResponse>("/api/mobile/reviews/weekly", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/mobile/backtesting — log a day's TOTAL backtesting
 * sessions (a total, not an increment; the core awards only
 * the delta at +15 XP per new session).
 */
export async function logBacktesting(
  activityDate: string,
  sessions: number,
): Promise<BacktestingResponse> {
  return apiFetch<BacktestingResponse>("/api/mobile/backtesting", {
    method: "POST",
    body: JSON.stringify({ activityDate, sessions }),
  });
}

/** POST /api/mobile/notifications/read — exactly one of { notification_id } or { all: true }. */
export async function markNotificationsRead(
  body: { notification_id: string } | { all: true },
): Promise<MarkReadResponse> {
  return apiFetch<MarkReadResponse>("/api/mobile/notifications/read", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ---------------- Phase 26 interactive coach ---------------- */

/**
 * POST /api/mobile/coach/chat — ask the Interactive AI Coach
 * (Phase 26; the Bearer surface of the web chat). The body is
 * { message, history } exactly as the shared handler's
 * contract requires — never an identity field. The response
 * is the server's structured answer (facts / inferences /
 * recommendations + evidence + narration mode), rendered
 * as-is: the app contains no coach or intent logic.
 */
export async function askCoach(
  message: string,
  history: CoachChatHistoryTurn[],
): Promise<CoachChatAnswer> {
  return apiFetch<CoachChatAnswer>("/api/mobile/coach/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}
