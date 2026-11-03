import { NextResponse } from "next/server";
import {
  createDefaultIntelligenceRunDeps,
  handleIntelligenceRun,
} from "@/lib/intelligence/background";

/**
 * /api/intelligence/run (Task 17)
 *
 * Scheduled entry point for the Background Intelligence
 * Engine. Authorised by the INTELLIGENCE_CRON_SECRET shared
 * secret only — a trader session must never trigger a
 * cross-user run, so no session is consulted. GET exists for
 * scheduler compatibility (Vercel Cron issues GET); POST is
 * the manual/ops invocation. All logic lives in
 * lib/intelligence/background.ts — this route is a thin
 * adapter. The response carries aggregate counts only.
 */
export const runtime = "nodejs";

async function run(request: Request) {
  const result = await handleIntelligenceRun(
    { authorization: request.headers.get("authorization") },
    createDefaultIntelligenceRunDeps(),
  );
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
