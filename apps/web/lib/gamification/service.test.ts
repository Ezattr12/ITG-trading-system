import { describe, expect, it } from "vitest";
import { isGenuineLevelUp, type LevelChange } from "./service";

function change(partial: Partial<LevelChange> = {}): LevelChange {
  return {
    previousLevel: null,
    currentLevel: null,
    previousLevelMinScore: null,
    currentLevelMinScore: null,
    ...partial,
  };
}

describe("isGenuineLevelUp (Task 22)", () => {
  it("fires on a genuine upward crossing", () => {
    expect(
      isGenuineLevelUp(
        change({
          previousLevel: "Risk Manager",
          currentLevel: "Strategy Operator",
          previousLevelMinScore: 40,
          currentLevelMinScore: 50,
        }),
      ),
    ).toBe(true);
  });

  it("does not fire when the level is unchanged", () => {
    expect(
      isGenuineLevelUp(
        change({
          previousLevel: "Strategy Operator",
          currentLevel: "Strategy Operator",
          previousLevelMinScore: 50,
          currentLevelMinScore: 50,
        }),
      ),
    ).toBe(false);
  });

  it("does not fire on a downward move (no false 'Level up')", () => {
    expect(
      isGenuineLevelUp(
        change({
          previousLevel: "Professional Trader",
          currentLevel: "Strategy Operator",
          previousLevelMinScore: 80,
          currentLevelMinScore: 50,
        }),
      ),
    ).toBe(false);
  });

  it("does not fire for a first-ever stored level (no previous)", () => {
    expect(
      isGenuineLevelUp(
        change({
          previousLevel: null,
          currentLevel: "Foundation",
          previousLevelMinScore: null,
          currentLevelMinScore: 0,
        }),
      ),
    ).toBe(false);
  });

  it("does not fire when the previous name is unknown to the current table", () => {
    // Transition case: a stored row still naming a retired band
    // ("Platinum") cannot be ranked against the new table, so a
    // rename alone never produces a notification.
    expect(
      isGenuineLevelUp(
        change({
          previousLevel: "Platinum",
          currentLevel: "Strategy Operator",
          previousLevelMinScore: null,
          currentLevelMinScore: 50,
        }),
      ),
    ).toBe(false);
  });
});
