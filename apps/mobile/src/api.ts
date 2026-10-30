import { supabase } from "./supabase";
import type {
  SessionBootstrapResponse,
  SummaryRange,
  SummaryResponse,
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
