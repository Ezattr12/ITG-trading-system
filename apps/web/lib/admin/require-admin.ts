import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { adminGate } from "./access";

/**
 * Server-side admin gate for admin PAGES (Phase 10 gate, hardened
 * 2026-11-02).
 *
 * Every admin page calls this as its first step, before any admin
 * query runs. The admin layout also gates, but a layout gate alone
 * does not stop the child page segment from executing and streaming
 * its rendered data into the document payload for non-admins
 * (production-probed 2026-11-02: audit entries and KPI counts were
 * present in non-admin page source). Gating inside the page, before
 * data access, means a denied request never fetches admin data at
 * all — there is nothing to leak. Denial is the indistinguishable
 * 404, matching the app's cross-user not-found idiom.
 *
 * Returns the signed-in admin user so pages keep their existing
 * `const user = await …` shape.
 */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) notFound();
  const gate = adminGate(user.profile ?? null);
  if (!gate.allowed) notFound();
  return user;
}
