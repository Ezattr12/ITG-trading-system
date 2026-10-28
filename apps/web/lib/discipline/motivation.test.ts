import { describe, expect, it } from "vitest";
import { motivationContextFor, selectMotivationMessage } from "./motivation";
import type { MotivationMessage } from "./types";

const messages: MotivationMessage[] = [
  { id: "m1", message: "General one.", context: "general", is_active: true },
  { id: "m2", message: "General two.", context: "general", is_active: true },
  { id: "m3", message: "After a loss.", context: "after_loss", is_active: true },
  { id: "m4", message: "Inactive.", context: "general", is_active: false },
];

describe("selectMotivationMessage", () => {
  it("prefers the requested context", () => {
    const picked = selectMotivationMessage(messages, "after_loss", null, "2026-10-27");
    expect(picked?.id).toBe("m3");
  });

  it("falls back to general when the context has no message", () => {
    const picked = selectMotivationMessage(messages, "streak", null, "2026-10-27");
    expect(picked?.context).toBe("general");
  });

  it("never repeats the last message when another is available", () => {
    const picked = selectMotivationMessage(messages, "general", "m1", "2026-10-27");
    expect(picked?.id).toBe("m2");
  });

  it("returns the only message when there is no alternative", () => {
    const picked = selectMotivationMessage(messages, "after_loss", "m3", "2026-10-27");
    expect(picked?.id).toBe("m3");
  });

  it("never picks an inactive message", () => {
    for (const day of ["2026-10-27", "2026-10-28", "2026-10-29"]) {
      expect(selectMotivationMessage(messages, "general", null, day)?.id).not.toBe("m4");
    }
  });

  it("returns null when there are no messages", () => {
    expect(selectMotivationMessage([], "general", null, "2026-10-27")).toBeNull();
  });

  it("is deterministic for the same day and context", () => {
    const a = selectMotivationMessage(messages, "general", null, "2026-10-27");
    const b = selectMotivationMessage(messages, "general", null, "2026-10-27");
    expect(a?.id).toBe(b?.id);
  });
});

describe("motivationContextFor", () => {
  it("a goal near completion wins over other contexts", () => {
    expect(
      motivationContextFor({ missedDays: 2, goalNearCompletion: true, disciplinedStreak: 5, hadLossToday: true }),
    ).toBe("goal_near");
  });

  it("a missed day beats a loss or a streak", () => {
    expect(
      motivationContextFor({ missedDays: 1, goalNearCompletion: false, disciplinedStreak: 5, hadLossToday: true }),
    ).toBe("missed_day");
  });

  it("a loss today beats a streak", () => {
    expect(
      motivationContextFor({ missedDays: 0, goalNearCompletion: false, disciplinedStreak: 5, hadLossToday: true }),
    ).toBe("after_loss");
  });

  it("a long disciplined streak is its own context", () => {
    expect(
      motivationContextFor({ missedDays: 0, goalNearCompletion: false, disciplinedStreak: 3, hadLossToday: false }),
    ).toBe("streak");
  });

  it("otherwise general", () => {
    expect(
      motivationContextFor({ missedDays: 0, goalNearCompletion: false, disciplinedStreak: 0, hadLossToday: false }),
    ).toBe("general");
    expect(
      motivationContextFor({ missedDays: null, goalNearCompletion: false, disciplinedStreak: 0, hadLossToday: false }),
    ).toBe("general");
  });
});
