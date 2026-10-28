/**
 * Admin panel types (Phase 10, spec §10, §40–42).
 *
 * Privacy rule, enforced by the types themselves: the admin user
 * list carries ONLY non-financial summary fields. Financial fields
 * (trading capital, monthly income, historical P&L) are never part
 * of `AdminUserSummary`; they travel only through
 * `AdminUserFinancials`, which is returned by one explicit,
 * audit-logged action (`viewFinancialDataAction`) and shown only
 * on the user-detail page after that action.
 */

export interface AdminUserSummary {
  id: string;
  full_name: string | null;
  country: string | null;
  trading_experience: string | null;
  verification_status: string;
  role: string;
  created_at: string;
}

export interface AdminUserFinancials {
  user_id: string;
  monthly_income: number | null;
  trading_capital: number | null;
  historical_profit: number | null;
  historical_loss: number | null;
  trades_real_money: boolean;
}

/** Columns an admin list/detail query may select by default. */
export const ADMIN_USER_PUBLIC_FIELDS =
  "id, full_name, country, trading_experience, verification_status, role, created_at";

/** Financial columns — never selected by a default admin query. */
export const ADMIN_USER_FINANCIAL_FIELDS =
  "monthly_income, trading_capital, historical_profit, historical_loss, trades_real_money";

export interface AdminUserDetail extends AdminUserSummary {
  level_name: string | null;
  level_score: number | null;
  trade_count: number;
  certificate_count: number;
  active_goal_count: number;
}

export interface AdminStats {
  user_count: number;
  admin_count: number;
  trade_count: number;
  certificates_issued: number;
  certificates_revoked: number;
  active_goals: number;
  open_risk_events: number;
  unread_notifications: number;
  discipline_events_7d: number;
  ai_insights_7d: number;
}

export interface AdminCertificateRow {
  id: string;
  certificate_id: string;
  user_id: string;
  month: string;
  status: string;
  issued_at: string | null;
  trader_name: string | null;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SystemSettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

export interface AdminAchievementRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  criteria: Record<string, unknown>;
  xp_reward: number;
}

export interface AdminLevelRow {
  id: string;
  name: string;
  slug: string;
  min_score: number;
  max_score: number | null;
  description: string | null;
}

export interface AdminOverview {
  stats: AdminStats;
  recent_audit: AuditLogRow[];
}
