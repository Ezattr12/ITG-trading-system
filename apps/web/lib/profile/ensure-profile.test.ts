import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * ensureProfileCore tests (Phase 21, M2): the first-login
 * profile creation extracted from getCurrentUser. Existing
 * row → created:false, no insert. Missing row → the exact
 * `{ id, full_name }` insert. A unique-violation race
 * resolves to created:false via re-read; any other failure
 * throws ProfileBootstrapError (the mobile bootstrap maps
 * it to its distinct 422; getCurrentUser catches it and
 * keeps its historic null-profile outcome).
 */

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("cores receive their client explicitly");
  },
  createServiceRoleSupabaseClient: () => null,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import { ensureProfileCore, ProfileBootstrapError } from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("ensureProfileCore (recording fake)", () => {
  it("existing profile → created:false and no insert", async () => {
    const tables: Record<string, Row[]> = {
      profiles: [{ id: USER, full_name: "Already Here" }],
    };
    const { client, fake } = fakeSupabase(tables);
    const res = await ensureProfileCore(client, {
      id: USER,
      user_metadata: { full_name: "Ignored Name" },
    });
    expect(res.created).toBe(false);
    expect(res.profile?.full_name).toBe("Already Here");
    expect(fake.insertsFor("profiles")).toHaveLength(0);
  });

  it("missing profile → created:true, payload exactly { id, full_name from metadata }", async () => {
    const tables: Record<string, Row[]> = { profiles: [] };
    const { client, fake } = fakeSupabase(tables);
    const res = await ensureProfileCore(client, {
      id: USER,
      user_metadata: { full_name: "New Trader" },
    });
    expect(res.created).toBe(true);
    expect(res.profile?.full_name).toBe("New Trader");
    expect(fake.insertsFor("profiles")).toEqual([{ id: USER, full_name: "New Trader" }]);
  });

  it("missing profile and no metadata name → full_name null (never invented)", async () => {
    const tables: Record<string, Row[]> = { profiles: [] };
    const { client, fake } = fakeSupabase(tables);
    const res = await ensureProfileCore(client, { id: USER, user_metadata: null });
    expect(res.created).toBe(true);
    expect(fake.insertsFor("profiles")).toEqual([{ id: USER, full_name: null }]);
  });
});

/** Hand stub: first select misses, insert errors as coded, re-read hits. */
function raceStub(errorCode: string) {
  const row = { id: USER, full_name: "Raced Trader" };
  let reads = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            reads += 1;
            return reads === 1
              ? { data: null, error: null }
              : { data: row, error: null };
          },
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { code: errorCode, message: "stubbed" },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return client;
}

describe("ensureProfileCore (insert outcomes)", () => {
  it("unique-violation race (23505) → re-read wins: created:false with the raced row", async () => {
    const res = await ensureProfileCore(raceStub("23505"), {
      id: USER,
      user_metadata: { full_name: "Raced Trader" },
    });
    expect(res.created).toBe(false);
    expect(res.profile?.full_name).toBe("Raced Trader");
  });

  it("a real insert failure (non-23505) → ProfileBootstrapError", async () => {
    await expect(
      ensureProfileCore(raceStub("42501"), { id: USER, user_metadata: {} }),
    ).rejects.toBeInstanceOf(ProfileBootstrapError);
  });
});
