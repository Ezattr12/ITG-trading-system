/**
 * ITG TraderOS — security boundary checks (Phase 11).
 *
 * Run: `npm run security:check` (also runs in CI after the tests).
 * Exits non-zero on the first failed check, so CI fails loudly.
 *
 * Checks:
 *  1. No "use client" file imports the server Supabase module
 *     (lib/supabase/server.ts) — that module can construct the
 *     service-role client, and it must never be bundled for the
 *     browser. Client components may import Server Actions (the
 *     action reference stays server-side) and type-only imports.
 *  2. Only lib/supabase/server.ts reads SUPABASE_SERVICE_ROLE_KEY
 *     (plus the MCP server's src/config.ts — the single sanctioned
 *     reader in that separate server process, audit inserts only).
 *  3. No secret-looking value in tracked source: JWTs, Supabase
 *     service keys, GitHub/AWS/Slack tokens, or a service-role key
 *     assigned a real (non-placeholder) value. Docs and .env.example
 *     are scanned too — placeholders are the only allowed values.
 *  4. .env.example contains placeholders only.
 *
 * This is a static guard, not a replacement for gitleaks in CI:
 * gitleaks scans the full git history; this script scans the
 * working tree and the service-role boundary.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FAILURES = [];

function fail(message) {
  FAILURES.push(message);
  console.error(`FAIL: ${message}`);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (["node_modules", ".next", ".git", "coverage"].includes(entry)) continue;
      walk(path, out);
    } else if (/\.(ts|tsx|js|mjs|sql|yml|yaml|md|json)$/.test(entry)) {
      // package-lock.json is a generated dependency manifest, not source.
      if (entry === "package-lock.json") continue;
      out.push(path);
    }
  }
  return out;
}

const SOURCE_DIRS = ["apps", "packages", "supabase", "scripts", ".github"];
const files = SOURCE_DIRS.flatMap((d) => {
  try {
    return walk(join(ROOT, d));
  } catch {
    return [];
  }
}).concat([join(ROOT, ".env.example"), join(ROOT, "README.md")]);

const read = (path) => readFileSync(path, "utf8");

// --- 1. Service-role boundary -------------------------------------------
for (const file of files) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = read(file);
  if (!content.includes('"use client"')) continue;
  const rel = relative(ROOT, file);
  if (/from\s+["']@?\/lib\/supabase\/server["']/.test(content)) {
    fail(`${rel}: "use client" file imports lib/supabase/server (service-role boundary)`);
  }
  if (content.includes("createServiceRoleSupabaseClient")) {
    fail(`${rel}: "use client" file references createServiceRoleSupabaseClient`);
  }
  if (content.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    fail(`${rel}: "use client" file references SUPABASE_SERVICE_ROLE_KEY`);
  }
}

// --- 2. Only server.ts may read the service-role key --------------------
// (This script itself is exempt: it checks for the string, it never reads the key.)
// One sanctioned equivalent exists per server-side process: the web
// app's lib/supabase/server.ts, and the MCP server's src/config.ts
// (Stage 3) — a separate Node process whose config module is the
// single place its key is read, used only for audit-log inserts.
for (const file of files) {
  if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
  const rel = relative(ROOT, file);
  if (rel === "apps/web/lib/supabase/server.ts") continue;
  if (rel === "apps/mcp-server/src/config.ts") continue;
  if (rel === "scripts/security-check.mjs") continue;
  if (read(file).includes("SUPABASE_SERVICE_ROLE_KEY")) {
    fail(`${rel}: reads SUPABASE_SERVICE_ROLE_KEY outside lib/supabase/server.ts`);
  }
}

// --- 3. Secret-looking values --------------------------------------------
const SECRET_PATTERNS = [
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
  [/\bsk-[A-Za-z0-9]{16,}/, "API key starting sk-"],
  [/\bghp_[A-Za-z0-9]{20,}/, "GitHub personal access token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained token"],
  [/\bAKIA[0-9A-Z]{16}/, "AWS access key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, "Supabase secret key"],
];
for (const file of files) {
  const rel = relative(ROOT, file);
  const content = read(file);
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(content)) fail(`${rel}: contains a ${label}`);
  }
  // A service-role key assigned anything other than the placeholder.
  const match = content.match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.+)/);
  if (match && !match[1].includes("your-supabase-service-role-key")) {
    fail(`${rel}: SUPABASE_SERVICE_ROLE_KEY has a non-placeholder value`);
  }
}

// --- 4. .env.example placeholders only -----------------------------------
const envExample = read(join(ROOT, ".env.example"));
for (const line of envExample.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const value = trimmed.split("=").slice(1).join("=").trim();
  if (value && !/your-|placeholder|localhost/.test(value)) {
    fail(`.env.example: non-placeholder value in "${trimmed}"`);
  }
}

if (FAILURES.length > 0) {
  console.error(`\nsecurity:check failed (${FAILURES.length} issue${FAILURES.length === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log(`security:check passed (${files.length} files scanned)`);
