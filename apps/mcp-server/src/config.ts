/**
 * Server configuration, from the process environment only.
 *
 * - SUPABASE_URL / SUPABASE_ANON_KEY: the project the server
 *   reads from. Without them the server still starts and
 *   answers `initialize`, but every tools/call fails with
 *   `upstream_error: not_configured` (design §5).
 * - SUPABASE_SERVICE_ROLE_KEY: used for exactly one thing —
 *   inserting audit_logs rows (see audit.ts). Never used to
 *   read trading data (design §2.3).
 * - ITG_SUPABASE_ACCESS_TOKEN: the trader's Supabase access
 *   token, supplied by the MCP host. This is the ONLY source
 *   of tenant identity (design §2.1). It is never logged and
 *   never echoed into a tool result.
 * - ITG_API_BASE_URL: base URL of the web app, used only by
 *   `compute_coach_insights` to reach the authenticated
 *   internal coach endpoint (Phase 20). Defaults to the
 *   production deployment.
 */

export const DEFAULT_API_BASE_URL = "https://itg-traderos.vercel.app";

export interface McpConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  accessToken: string;
  /** Web app base URL for the internal coach endpoint (Phase 20). */
  apiBaseUrl: string;
  /** True when the server can reach Supabase at all (URL + anon key). */
  configured: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const supabaseUrl = env.SUPABASE_URL ?? "";
  const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? "";
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const accessToken = env.ITG_SUPABASE_ACCESS_TOKEN ?? "";
  const apiBaseUrl = (env.ITG_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    accessToken,
    apiBaseUrl,
    configured: supabaseUrl.length > 0 && supabaseAnonKey.length > 0,
  };
}
