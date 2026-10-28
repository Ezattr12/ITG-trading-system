import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeAdminUserSummary } from "./access";
import {
  ADMIN_USER_PUBLIC_FIELDS,
  type AdminCertificateRow,
  type AdminLevelRow,
  type AdminStats,
  type AdminUserDetail,
  type AdminUserSummary,
  type AuditLogRow,
  type AdminAchievementRow,
  type SystemSettingRow,
} from "./types";

/**
 * Admin reads (Phase 10). Server Components / Actions call these
 * with the signed-in user's Supabase client, so RLS enforces the
 * boundary: only a user whose profile role is 'admin' can read
 * other traders' rows (profiles, certificates, audit_logs,
 * goals, risk_rules — see migrations 0002/0005/0006/0008–0010).
 * No service-role client is used for reads.
 *
 * Privacy: the user list selects ONLY the public fields
 * (ADMIN_USER_PUBLIC_FIELDS). Financial columns are never in a
 * default query — see `getAdminUserFinancials` and the
 * audit-logged financial-view action.
 */

type CountQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function countExact(
  supabase: SupabaseClient,
  table: string,
  filter?: (q: CountQuery) => CountQuery,
): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true }) as unknown as CountQuery;
  if (filter) query = filter(query);
  const { count } = await query;
  return count ?? 0;
}

export async function getAdminStats(supabase: SupabaseClient): Promise<AdminStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [
    userCount,
    adminCount,
    tradeCount,
    issued,
    revoked,
    activeGoals,
    openRisk,
    unread,
    discipline7d,
    insights7d,
  ] = await Promise.all([
    countExact(supabase, "profiles"),
    countExact(supabase, "profiles", (q) => q.eq("role", "admin")),
    countExact(supabase, "trades"),
    countExact(supabase, "certificates", (q) => q.eq("status", "issued")),
    countExact(supabase, "certificates", (q) => q.eq("status", "revoked")),
    countExact(supabase, "goals", (q) => q.eq("status", "active")),
    countExact(supabase, "risk_events", (q) => q.is("resolved_at", null)),
    countExact(supabase, "notifications", (q) => q.eq("is_read", false)),
    countExact(supabase, "discipline_events", (q) => q.gte("created_at", sevenDaysAgo)),
    countExact(supabase, "ai_insights", (q) => q.gte("created_at", sevenDaysAgo)),
  ]);
  return {
    user_count: userCount,
    admin_count: adminCount,
    trade_count: tradeCount,
    certificates_issued: issued,
    certificates_revoked: revoked,
    active_goals: activeGoals,
    open_risk_events: openRisk,
    unread_notifications: unread,
    discipline_events_7d: discipline7d,
    ai_insights_7d: insights7d,
  };
}

export async function listAdminUsers(
  supabase: SupabaseClient,
  limit = 100,
): Promise<AdminUserSummary[]> {
  const { data } = await supabase
    .from("profiles")
    .select(ADMIN_USER_PUBLIC_FIELDS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map(sanitizeAdminUserSummary);
}

export async function getAdminUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<AdminUserSummary | null> {
  const { data } = await supabase
    .from("profiles")
    .select(ADMIN_USER_PUBLIC_FIELDS)
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return sanitizeAdminUserSummary(data as Record<string, unknown>);
}

export async function getAdminUserDetail(
  supabase: SupabaseClient,
  userId: string,
): Promise<AdminUserDetail | null> {
  const summary = await getAdminUser(supabase, userId);
  if (!summary) return null;
  const [levelRes, tradesRes, certsRes, goalsRes] = await Promise.all([
    supabase
      .from("user_levels")
      .select("score, levels(name)")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("trades").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("certificates").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase
      .from("goals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);
  const level = (levelRes.data ?? null) as { score: number; levels: { name: string } | null } | null;
  return {
    ...summary,
    level_name: level?.levels?.name ?? null,
    level_score: level?.score ?? null,
    trade_count: tradesRes.count ?? 0,
    certificate_count: certsRes.count ?? 0,
    active_goal_count: goalsRes.count ?? 0,
  };
}

/**
 * Financial fields for one trader — called ONLY from the
 * audit-logged financial-view flow. Never used by list pages.
 */
export async function getAdminUserFinancials(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, monthly_income, trading_capital, historical_profit, historical_loss, trades_real_money")
    .eq("id", userId)
    .maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

export async function listAdminCertificates(
  supabase: SupabaseClient,
  limit = 100,
): Promise<AdminCertificateRow[]> {
  const { data } = await supabase
    .from("certificates")
    .select("id, certificate_id, user_id, month, status, issued_at, profiles(full_name)")
    .order("month", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as {
    id: string;
    certificate_id: string;
    user_id: string;
    month: string;
    status: string;
    issued_at: string | null;
    profiles: { full_name: string | null } | null;
  }[]).map((c) => ({
    id: c.id,
    certificate_id: c.certificate_id,
    user_id: c.user_id,
    month: c.month,
    status: c.status,
    issued_at: c.issued_at,
    trader_name: c.profiles?.full_name ?? null,
  }));
}

export async function listAuditLogs(
  supabase: SupabaseClient,
  limit = 100,
): Promise<AuditLogRow[]> {
  const { data } = await supabase
    .from("audit_logs")
    .select("id, user_id, actor_id, action, entity_type, entity_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditLogRow[];
}

/** Recent admin audit rows for one trader — used to gate the financial view. */
export async function getRecentAuditForUser(
  supabase: SupabaseClient,
  adminId: string,
  targetUserId: string,
): Promise<{ action: string; actor_id: string | null; user_id: string | null; created_at: string }[]> {
  const { data } = await supabase
    .from("audit_logs")
    .select("action, actor_id, user_id, created_at")
    .eq("actor_id", adminId)
    .eq("user_id", targetUserId)
    .eq("action", "admin.financial_view")
    .order("created_at", { ascending: false })
    .limit(5);
  return (data ?? []) as { action: string; actor_id: string | null; user_id: string | null; created_at: string }[];
}

export async function listAdminAchievements(
  supabase: SupabaseClient,
): Promise<AdminAchievementRow[]> {
  const { data } = await supabase
    .from("achievements")
    .select("id, name, slug, description, category, criteria, xp_reward")
    .order("created_at", { ascending: true });
  return (data ?? []) as AdminAchievementRow[];
}

export async function listAdminLevels(supabase: SupabaseClient): Promise<AdminLevelRow[]> {
  const { data } = await supabase
    .from("levels")
    .select("id, name, slug, min_score, max_score, description")
    .order("min_score", { ascending: true });
  return (data ?? []) as AdminLevelRow[];
}

export async function listSystemSettings(
  supabase: SupabaseClient,
): Promise<SystemSettingRow[]> {
  const { data } = await supabase
    .from("system_settings")
    .select("key, value, description, updated_at")
    .order("key", { ascending: true });
  return (data ?? []) as SystemSettingRow[];
}
