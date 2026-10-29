import { createClient } from "@supabase/supabase-js";
import type { McpConfig } from "./config.js";
import type { DbClient } from "./db.js";

/**
 * Authentication (design §2.1–2.2).
 *
 * The trader's Supabase access token — supplied by the MCP
 * host via ITG_SUPABASE_ACCESS_TOKEN — is the ONLY source of
 * tenant identity. It is validated against Supabase Auth on
 * every tools/call (`auth.getUser`), and the user id is
 * derived from the validated token. Tool arguments never
 * carry a user/tenant id.
 *
 * Reads then run on a client created with the anon key + the
 * user's JWT, so Postgres RLS applies exactly as it does for
 * the web app; the tool layer additionally filters by the
 * derived user id as defense-in-depth.
 */

export interface AuthContext {
  userId: string;
  /** RLS-scoped client carrying the trader's JWT. */
  client: DbClient;
}

export interface Authenticator {
  authenticate(token: string | undefined): Promise<AuthContext | null>;
}

export function createAuthenticator(config: McpConfig): Authenticator {
  return {
    async authenticate(token) {
      if (!token) return null;
      const anon = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await anon.auth.getUser(token);
      if (error || !data.user) return null;
      const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      return { userId: data.user.id, client: client as unknown as DbClient };
    },
  };
}
