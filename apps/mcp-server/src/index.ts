#!/usr/bin/env node
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "./config.js";
import { createAuthenticator } from "./auth.js";
import { createToolCaller } from "./tools.js";
import { createRequestHandler } from "./server.js";
import { RateLimiter } from "./ratelimit.js";
import type { DbClient } from "./db.js";

/**
 * ITG MCP server — stdio entry point.
 *
 * Wiring only: configuration from the environment, an
 * authenticator that validates the trader's Supabase access
 * token, a service-role client used ONLY for audit inserts,
 * and the newline-delimited JSON-RPC loop on stdin/stdout.
 * All protocol and tool logic lives in server.ts / tools.ts.
 *
 * Diagnostics go to stderr — stdout is the protocol channel
 * and must carry nothing but JSON-RPC frames.
 */

const config = loadConfig();

const serviceClient: DbClient | null =
  config.configured && config.supabaseServiceRoleKey
    ? (createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as DbClient)
    : null;

const callTool = createToolCaller({
  config,
  authenticator: createAuthenticator(config),
  serviceClient,
  rateLimiter: new RateLimiter(60, 1),
});

const handleLine = createRequestHandler(callTool);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

// Serialize request handling so responses stay in order and
// audit rows land in call order.
let chain: Promise<void> = Promise.resolve();
rl.on("line", (line) => {
  if (line.trim() === "") return;
  chain = chain.then(async () => {
    const response = await handleLine(line);
    if (response !== null) process.stdout.write(`${response}\n`);
  });
});
rl.on("close", () => {
  void chain.then(() => process.exit(0));
});

if (!config.configured) {
  process.stderr.write(
    "itg-mcp-server: SUPABASE_URL / SUPABASE_ANON_KEY not set — tools will return upstream_error: not_configured\n",
  );
}
