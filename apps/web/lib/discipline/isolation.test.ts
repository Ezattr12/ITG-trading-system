import { describe, expect, it } from "vitest";
import { assertScoped, fakeSupabase } from "../test-helpers/fake-supabase";
import { getGoalById, getGoals } from "./queries";

/**
 * Goals isolation at the query layer (Phase 12, spec §43).
 * A trader must never see another trader's goals — the list and
 * the single-goal read both scope by user_id, and a goal id that
 * belongs to someone else resolves to null, not to the row.
 */

const goalA = {
  id: "g-a",
  user_id: "user-a",
  title: "Journal 5 trades",
  period: "weekly",
  target_value: 5,
  status: "active",
  deleted_at: null,
  created_at: "2026-10-01T00:00:00Z",
};

const goalB = { ...goalA, id: "g-b", user_id: "user-b", title: "Someone else's goal" };

function seed() {
  return fakeSupabase({ goals: [goalA, goalB] });
}

describe("goals isolation", () => {
  it("lists only the requesting trader's goals", async () => {
    const { client, fake } = seed();
    const goals = await getGoals(client, "user-a");
    expect(goals.map((g) => g.id)).toEqual(["g-a"]);
    assertScoped(fake.queriesFor("goals")[0]!, "user_id", "user-a");
  });

  it("returns null for another trader's goal id", async () => {
    const { client, fake } = seed();
    expect(await getGoalById(client, "user-a", "g-b")).toBeNull();
    const q = fake.queriesFor("goals")[0]!;
    assertScoped(q, "user_id", "user-a");
    assertScoped(q, "id", "g-b");
  });

  it("returns the goal for its owner", async () => {
    const { client } = seed();
    const goal = await getGoalById(client, "user-a", "g-a");
    expect(goal?.title).toBe("Journal 5 trades");
  });
});
