/**
 * Lesson / repeated-mistake analysis (Phase 3, spec §15).
 *
 * Every trade may carry "What did I learn?". Lessons are the
 * trader's own words. This module finds repeats: lessons that
 * say the same thing (after normalisation) on two or more trades.
 * It never invents a lesson and never rewrites the trader's
 * text — the display text is the first lesson as written.
 * The "most repeated mistake" insight in Phase 4 / Phase 9
 * reads from this function, over real lessons only.
 */

export interface LessonInput {
  id: string;
  tradeId: string | null;
  text: string;
  createdAt: string;
}

export interface RepeatedLesson {
  /** Normalised key used for grouping. */
  key: string;
  /** The lesson as the trader first wrote it. */
  displayText: string;
  count: number;
  tradeIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Lower-case, collapse whitespace, strip surrounding punctuation. */
export function normalizeLesson(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findRepeatedLessons(lessons: LessonInput[]): RepeatedLesson[] {
  const byKey = new Map<string, RepeatedLesson>();
  for (const lesson of lessons) {
    const key = normalizeLesson(lesson.text);
    if (key.length < 3) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (lesson.tradeId) existing.tradeIds.push(lesson.tradeId);
      if (lesson.createdAt > existing.lastSeenAt) existing.lastSeenAt = lesson.createdAt;
    } else {
      byKey.set(key, {
        key,
        displayText: lesson.text.trim(),
        count: 1,
        tradeIds: lesson.tradeId ? [lesson.tradeId] : [],
        firstSeenAt: lesson.createdAt,
        lastSeenAt: lesson.createdAt,
      });
    }
  }
  return [...byKey.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** The single most repeated lesson, or null when nothing repeats. */
export function mostRepeatedLesson(lessons: LessonInput[]): RepeatedLesson | null {
  return findRepeatedLessons(lessons)[0] ?? null;
}
