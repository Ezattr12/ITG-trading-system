import { describe, expect, it } from "vitest";
import { findRepeatedLessons, mostRepeatedLesson, normalizeLesson } from "./lessons";

const lessons = [
  { id: "1", tradeId: "t1", text: "Entering before confirmation.", createdAt: "2026-10-10T08:00:00.000Z" },
  { id: "2", tradeId: "t2", text: "entering before confirmation", createdAt: "2026-10-12T08:00:00.000Z" },
  { id: "3", tradeId: "t3", text: "Entering  before   confirmation!", createdAt: "2026-10-14T08:00:00.000Z" },
  { id: "4", tradeId: "t4", text: "Risk was too large.", createdAt: "2026-10-15T08:00:00.000Z" },
];

describe("normalizeLesson", () => {
  it("lower-cases, collapses whitespace and strips punctuation", () => {
    expect(normalizeLesson("  Entering  BEFORE confirmation! ")).toBe("entering before confirmation");
  });
});

describe("findRepeatedLessons (spec §15)", () => {
  it("groups the same lesson across trades despite casing/punctuation", () => {
    const repeated = findRepeatedLessons(lessons);
    expect(repeated).toHaveLength(1);
    expect(repeated[0].count).toBe(3);
    expect(repeated[0].displayText).toBe("Entering before confirmation.");
    expect(repeated[0].tradeIds).toEqual(["t1", "t2", "t3"]);
  });
  it("returns nothing when no lesson repeats", () => {
    expect(findRepeatedLessons([lessons[3]])).toEqual([]);
    expect(findRepeatedLessons([])).toEqual([]);
  });
  it("mostRepeatedLesson returns the top repeat or null", () => {
    expect(mostRepeatedLesson(lessons)?.count).toBe(3);
    expect(mostRepeatedLesson([lessons[3]])).toBeNull();
  });
});
