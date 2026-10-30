import { NextResponse } from "next/server";
import {
  createDefaultCoachEndpointDeps,
  handleCoachInsightsCompute,
} from "@/lib/coach/endpoint";

/**
 * POST /api/internal/coach-insights (Phase 20)
 *
 * Internal, token-authenticated, compute-only access to the
 * deterministic Coach Engine. The caller (today: the MCP
 * server's `compute_coach_insights` tool) presents a trader's
 * Supabase access token; the trader identity comes from the
 * validated token only. All logic lives in
 * lib/coach/endpoint.ts — this route is a thin adapter.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token =
    authorization !== null && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim() || null
      : null;

  const text = await request.text();
  let body: unknown = null;
  let jsonMalformed = false;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      jsonMalformed = true;
    }
  }

  const result = await handleCoachInsightsCompute(
    { token, body, jsonMalformed },
    createDefaultCoachEndpointDeps(),
  );
  return NextResponse.json(result.body, { status: result.status });
}
