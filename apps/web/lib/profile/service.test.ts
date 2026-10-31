import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";

/**
 * Profile service core tests (Phase 21): update + avatar
 * cores extracted from lib/auth/actions.ts must keep the
 * exact writes, messages and audit behaviour. The
 * service-role engines (audit) run against the recording
 * admin fake via the mocked server module; storage is a
 * recording stub attached to the user fake.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("cores receive their client explicitly");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import { updateProfileCore, uploadAvatarCore } from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setup() {
  const tables: Record<string, Row[]> = {
    profiles: [{ id: USER, full_name: "Old Name", avatar_url: null }],
    audit_logs: [],
  };
  const user = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  harness.adminClient = admin.fake;
  const uploads: { bucket: string; path: string; contentType?: string }[] = [];
  (user.fake as unknown as { storage: unknown }).storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _file: File, opts?: { contentType?: string }) => {
        uploads.push({ bucket, path, contentType: opts?.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://example.test/storage/${bucket}/${path}` },
      }),
    }),
  };
  return { user, admin, tables, uploads };
}

const validProfile = {
  fullName: "New Name",
  fatherName: null,
  dateOfBirth: "1990-01-15",
  country: "GB",
  tradingExperience: "3 years",
  tradingEducation: null,
  backtestingExperience: true,
  backtestedTrades: 120,
  realTradingExperience: true,
  realTradesCount: 40,
  demoTrading: false,
  employmentStatus: "full_time",
  monthlyIncome: null,
  tradingCapital: 25000,
  tradesRealMoney: true,
};

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("updateProfileCore", () => {
  it("writes the profile columns for the token user and audits profile.updated", async () => {
    const { user, admin, tables } = setup();
    const result = await updateProfileCore(user.client, USER, validProfile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.full_name).toBe("New Name");
    expect(result.profile.trading_capital).toBe(25000);
    const row = tables.profiles.find((r) => r.id === USER);
    expect(row?.full_name).toBe("New Name");
    expect(row?.employment_status).toBe("full_time");
    expect(
      admin.fake.insertsFor("audit_logs").some((r) => r.action === "profile.updated"),
    ).toBe(true);
  });

  it("persists employment_status, trading_experience and trading_education to the profiles row", async () => {
    // Regression (M2 correction pass): these three columns drive
    // the profile-completion calculation, so the write core must
    // carry them through to the stored row verbatim — including a
    // real work status replacing the onboarding "not_provided"
    // sentinel. "employed_other_job" also exercises the schema
    // refine that requires a monthly income.
    const { user, tables } = setup();
    const result = await updateProfileCore(user.client, USER, {
      ...validProfile,
      tradingExperience: "5 years",
      tradingEducation: "Mentored programme",
      employmentStatus: "employed_other_job",
      monthlyIncome: 3200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = tables.profiles.find((r) => r.id === USER);
    expect(row?.employment_status).toBe("employed_other_job");
    expect(row?.trading_experience).toBe("5 years");
    expect(row?.trading_education).toBe("Mentored programme");
    expect(result.profile.employment_status).toBe("employed_other_job");
    expect(result.profile.trading_experience).toBe("5 years");
    expect(result.profile.trading_education).toBe("Mentored programme");
  });

  it("rejects an empty full name with the schema message and writes nothing", async () => {
    const { user, tables } = setup();
    const result = await updateProfileCore(user.client, USER, {
      ...validProfile,
      fullName: "   ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
    expect(result.error).toBe("Full name is required");
    expect(tables.profiles.find((r) => r.id === USER)?.full_name).toBe("Old Name");
  });
});

describe("uploadAvatarCore", () => {
  it("uploads to the per-user path and stores the public URL on the profile", async () => {
    const { user, tables, uploads } = setup();
    const file = new File([new Uint8Array([1, 2, 3])], "photo.PNG", { type: "image/png" });
    const result = await uploadAvatarCore(user.client, USER, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe("avatars");
    expect(uploads[0].path).toMatch(new RegExp(`^${USER}/avatar-\\d+\\.png$`));
    expect(result.avatarUrl).toContain(uploads[0].path);
    expect(tables.profiles.find((r) => r.id === USER)?.avatar_url).toBe(result.avatarUrl);
  });

  it("rejects a missing file and a non-image with the shared messages", async () => {
    const { user, uploads } = setup();
    const missing = await uploadAvatarCore(user.client, USER, null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("invalid_input");
      expect(missing.error).toBe("Choose an image file first.");
    }
    const text = new File(["hello"], "notes.txt", { type: "text/plain" });
    const notImage = await uploadAvatarCore(user.client, USER, text);
    expect(notImage.ok).toBe(false);
    if (!notImage.ok) {
      expect(notImage.error).toBe("Only image files can be used as a profile photo.");
    }
    expect(uploads).toHaveLength(0);
  });
});
