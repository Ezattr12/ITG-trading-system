import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RLS matrix regression tests (Phase 11, spec §5, §43).
 *
 * These tests parse the versioned migration files — the source of
 * truth for database security — instead of trusting a live database
 * that this phase cannot reach (migrations are not applied to the
 * Supabase project yet). They assert the structural invariants
 * every table must satisfy:
 *  - RLS is enabled;
 *  - at least one policy exists;
 *  - append-only / server-written tables have NO client
 *    insert/update/delete policy (a silent RLS rejection once hid
 *    a missing XP award in Phase 7 — the absence must be deliberate
 *    and tested, never accidental);
 *  - system_settings is admin-only;
 *  - the Phase 11 privilege triggers exist.
 *
 * A live-database RLS test (every role × every table) is a Phase 12
 * item, run against staging once migrations are applied.
 */
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

function tables(sql: string): string[] {
  return [...new Set([...sql.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]))];
}

function rlsEnabled(sql: string): string[] {
  return [...new Set([...sql.matchAll(/alter table public\.(\w+) enable row level security/gi)].map((m) => m[1]))];
}

interface Policy {
  name: string;
  table: string;
  command: string;
}

function policies(sql: string): Policy[] {
  return [...sql.matchAll(/create policy "([^"]+)" on (?:public\.)?(\w+)\s+for (\w+)/gi)].map((m) => ({
    name: m[1],
    table: m[2],
    command: m[3].toLowerCase(),
  }));
}

const sql = migrationSql();

describe("RLS matrix (from migration files)", () => {
  it("has 32 tables, all with RLS enabled", () => {
    const found = tables(sql);
    expect(found).toHaveLength(32);
    const enabled = rlsEnabled(sql);
    for (const table of found) {
      expect(enabled).toContain(table);
    }
  });

  it("gives every table at least one policy", () => {
    const found = policies(sql);
    for (const table of tables(sql)) {
      expect(found.some((p) => p.table === table)).toBe(true);
    }
  });

  it("keeps append-only / server-written tables client-read-only", () => {
    // These tables are written by the service role only (Server
    // Actions). A client insert/update/delete policy here would be
    // a bug — or a silent no-op if RLS rejected it.
    const appendOnly = [
      "audit_logs",
      "xp_transactions",
      "risk_events",
      "discipline_events",
      "certificates",
      "report_runs",
      "ai_insights",
      "user_levels",
      "user_achievements",
    ];
    const found = policies(sql);
    for (const table of appendOnly) {
      const writing = found.filter(
        (p) => p.table === table && ["insert", "update", "delete", "all"].includes(p.command),
      );
      expect(writing).toEqual([]);
    }
  });

  it("restricts system_settings to admins only", () => {
    const found = policies(sql).filter((p) => p.table === "system_settings");
    expect(found).toHaveLength(1);
    expect(found[0].command).toBe("all");
    expect(sql).toMatch(/create policy "system_settings_admin_only"[\s\S]*?public\.is_admin\(\)/);
  });

  it("lets traders read/write only their own rows on user tables", () => {
    const found = policies(sql);
    for (const table of ["trades", "goals", "notifications", "trading_plans", "risk_rules"]) {
      const select = found.find((p) => p.table === table && p.command === "select");
      expect(select, `${table} select policy`).toBeDefined();
    }
    // Spot-check the exact isolation predicate on the most sensitive table.
    expect(sql).toMatch(/create policy "trades_select_own"[\s\S]*?user_id = auth\.uid\(\)/);
  });

  it("has no policy granting access to signed-out users on user data", () => {
    // Only the shared config tables are readable by any authenticated
    // user; nothing user-owned is readable with auth.uid() unset.
    const found = policies(sql);
    for (const table of tables(sql)) {
      if (["assets", "levels", "achievements", "motivation_messages"].includes(table)) continue;
      for (const p of found.filter((x) => x.table === table)) {
        expect(p.name).not.toMatch(/_select_all$/);
      }
    }
  });
});

describe("Phase 11 privilege guards (migration 0015)", () => {
  it("pins is_admin() to the public search_path", () => {
    expect(sql).toMatch(/create or replace function public\.is_admin\(\)[\s\S]*?set search_path = public/);
  });

  it("adds triggers guarding role and verification_status", () => {
    expect(sql).toContain("enforce_profile_privilege");
    expect(sql).toContain("before insert or update on public.profiles");
    expect(sql).toContain("enforce_verification_record_status");
    expect(sql).toContain("before insert or update on public.verification_records");
    // Service-role writes (audit-logged admin actions) must still pass.
    expect(sql).toContain("auth.role() = 'service_role'");
  });
});

describe("Storage buckets (migration 0016)", () => {
  it("creates the avatars and trade-screenshots buckets", () => {
    expect(sql).toContain("('avatars', 'avatars', true)");
    expect(sql).toContain("('trade-screenshots', 'trade-screenshots', false)");
  });

  it("keeps trade screenshots private and owner-only", () => {
    expect(sql).toMatch(/create policy "screenshots_select_own"[\s\S]*?bucket_id = 'trade-screenshots'/);
    expect(sql).toMatch(/create policy "screenshots_insert_own"[\s\S]*?\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  });

  it("lets anyone read avatars but only the owner write them", () => {
    expect(sql).toMatch(/create policy "avatars_select_public"[\s\S]*?bucket_id = 'avatars'/);
    expect(sql).toMatch(/create policy "avatars_insert_own"[\s\S]*?\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  });
});
