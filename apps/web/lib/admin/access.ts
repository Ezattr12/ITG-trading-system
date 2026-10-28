import type { AdminUserFinancials, AdminUserSummary } from "./types";

/**
 * Admin access control + financial-privacy rules (Phase 10, spec §10).
 *
 * Pure functions — no I/O, fully unit-tested. The pages and Server
 * Actions call these; they never decide access by reading a role
 * from the browser. `profiles.role` defaults to 'trader' (migration
 * 0002) and `public.is_admin()` is the database-side check used by
 * RLS; the app-side check here is the same rule applied to the
 * signed-in user's profile row.
 *
 * NOTE (Phase 11 audit): the 'auditor' role exists in the user_role
 * enum but has NO distinct access anywhere — RLS grants nothing to
 * auditors (is_admin() checks role = 'admin' only) and adminGate
 * below denies them. An auditor today is treated exactly like a
 * trader. Wiring read-only auditor access is a deliberate product
 * decision for a later phase, not a silent default.
 */

/** The only role allowed into /admin. 'auditor' is denied today (see the note above) — never write-access by default. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}

export function isAuditorRole(role: string | null | undefined): boolean {
  return role === "auditor";
}

export type AdminGate =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Gate for every admin page and action. Never redirects — the caller renders the reason. */
export function adminGate(profile: { role: string } | null | undefined): AdminGate {
  if (!profile) return { allowed: false, reason: "Please log in first." };
  if (!isAdminRole(profile.role)) {
    return {
      allowed: false,
      reason: "You are not authorised to view the admin area. Admin access is limited to ITG administrators.",
    };
  }
  return { allowed: true };
}

/** Write gate: identical to adminGate today — only role 'admin' may write. */
export function adminWriteGate(profile: { role: string } | null | undefined): AdminGate {
  const gate = adminGate(profile);
  if (!gate.allowed) return gate;
  return { allowed: true };
}

/**
 * An admin may not remove their own admin role — otherwise the
 * platform could be left with no admin and no way back.
 * Returns an error message, or null when the change is allowed.
 */
export function roleChangeError(
  adminId: string,
  targetUserId: string,
  newRole: string,
): string | null {
  if (adminId === targetUserId && newRole !== "admin") {
    return "You cannot remove your own admin role.";
  }
  return null;
}

/** Financial columns — a default admin query must never include these. */
export const FINANCIAL_FIELDS = [
  "monthly_income",
  "trading_capital",
  "historical_profit",
  "historical_loss",
] as const;

/**
 * Strip every financial (and otherwise private) field from a raw
 * profile row, returning only the admin-list summary. If a caller
 * accidentally passes a full profile row, the financial values do
 * not survive this function.
 */
export function sanitizeAdminUserSummary(
  row: Record<string, unknown>,
): AdminUserSummary {
  return {
    id: String(row.id ?? ""),
    full_name: (row.full_name as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    trading_experience: (row.trading_experience as string | null) ?? null,
    verification_status: String(row.verification_status ?? "not_provided"),
    role: String(row.role ?? "trader"),
    created_at: String(row.created_at ?? ""),
  };
}

/** True when a row contains no financial field at all. */
export function hasNoFinancialFields(row: Record<string, unknown>): boolean {
  return FINANCIAL_FIELDS.every((f) => !(f in row));
}

/**
 * A financial view is only valid for a short window after the
 * explicit, audit-logged `admin.financial_view` action. The
 * detail page checks the audit log (not a URL flag) before it
 * shows financials, so a bookmarked URL alone reveals nothing.
 */
export const FINANCIAL_ACCESS_WINDOW_MINUTES = 15;

export function hasRecentFinancialAccess(
  auditRows: { action: string; actor_id: string | null; user_id: string | null; created_at: string }[],
  adminId: string,
  targetUserId: string,
  nowMs: number = Date.now(),
): boolean {
  const windowMs = FINANCIAL_ACCESS_WINDOW_MINUTES * 60 * 1000;
  return auditRows.some(
    (r) =>
      r.action === "admin.financial_view" &&
      r.actor_id === adminId &&
      r.user_id === targetUserId &&
      nowMs - new Date(r.created_at).getTime() <= windowMs &&
      nowMs - new Date(r.created_at).getTime() >= 0,
  );
}

/** Build the financial view from a profile row — only ever called after the audit-logged action. */
export function toAdminUserFinancials(
  userId: string,
  row: Record<string, unknown>,
): AdminUserFinancials {
  return {
    user_id: userId,
    monthly_income: (row.monthly_income as number | null) ?? null,
    trading_capital: (row.trading_capital as number | null) ?? null,
    historical_profit: (row.historical_profit as number | null) ?? null,
    historical_loss: (row.historical_loss as number | null) ?? null,
    trades_real_money: Boolean(row.trades_real_money ?? false),
  };
}
