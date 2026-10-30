import { NextResponse } from "next/server";
import {
  createDefaultCoachChatDeps,
  handleCoachChat,
} from "@/lib/coach/chat-handler";

/**
 * POST /api/coach/chat (Phase 22)
 *
 * Interactive AI Trading Coach for the web app. Session
 * (cookie) authenticated; the trader identity comes from
 * the session only, and all logic lives in
 * lib/coach/chat-handler.ts + lib/coach/chat.ts — this
 * route is a thin adapter. The coach is read-only: it
 * analyses the trader's own data and never writes,
 * modifies or executes anything.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const result = await handleCoachChat(
    { body, jsonMalformed },
    createDefaultCoachChatDeps(),
  );
  return NextResponse.json(result.body, { status: result.status });
}
