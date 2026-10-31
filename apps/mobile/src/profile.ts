import type { LevelRowLite, ProfileRow } from "./types";

/**
 * Profile derivations for mobile — PORTS of the web app's pure
 * profile logic. These functions must stay in lockstep with
 * their web sources:
 * - calcProfileCompletion  ← apps/web/lib/profile/completion.ts
 * - progressToNextLevel    ← apps/web/lib/gamification/scoring.ts
 *   (+ calcLevelForScore / DEFAULT_LEVELS from @itg/calc)
 * - identity helpers       ← apps/web/lib/profile/identity.ts
 *
 * Everything here is computed from the caller's STORED rows
 * (read under RLS) at render time. Nothing is stored, nothing
 * is invented: a value with no source row is null / [] and the
 * screen omits it.
 */

/* ---------------- profile completion + verified badge ----------------
 *
 * The "ITG Verified Profile" badge is a PROFILE-COMPLETENESS
 * badge, not identity/KYC verification: it is active only when
 * every required piece of professional profile information is
 * actually present in the stored profile row (100% of the 8
 * items below). It is derived from the completion result on
 * every render — there is no stored boolean that could drift
 * out of sync. The admin-reviewed `verification_status` column
 * is a separate status, shown separately on the profile.
 */

export interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  /** What to do when this item is missing. */
  hint: string;
}

export interface ProfileCompletion {
  /** 0–100, whole percent. */
  percent: number;
  completed: number;
  total: number;
  items: CompletionItem[];
  missing: CompletionItem[];
  /** True only when every required item is complete. */
  verified: boolean;
  /** The first missing item's hint, or null when complete. */
  nextStep: string | null;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const ITEM_DEFS: {
  key: string;
  label: string;
  hint: string;
  check: (p: ProfileRow) => boolean;
}[] = [
  {
    key: "full_name",
    label: "Full name",
    hint: "Add your full name",
    check: (p) => hasText(p.full_name),
  },
  {
    key: "avatar_url",
    label: "Profile photo",
    hint: "Add a profile photo",
    check: (p) => hasText(p.avatar_url),
  },
  {
    key: "father_name",
    label: "Father's name",
    hint: "Add your father's name",
    check: (p) => hasText(p.father_name),
  },
  {
    key: "date_of_birth",
    label: "Date of birth",
    hint: "Add your date of birth",
    check: (p) => hasText(p.date_of_birth),
  },
  {
    key: "country",
    label: "Country",
    hint: "Add your country",
    check: (p) => hasText(p.country),
  },
  {
    key: "trading_experience",
    label: "Trading experience",
    hint: "Add your trading experience",
    check: (p) => hasText(p.trading_experience),
  },
  {
    key: "trading_education",
    label: "Trading education",
    hint: "Add your trading education",
    check: (p) => hasText(p.trading_education),
  },
  {
    key: "employment_status",
    label: "Work status",
    hint: "Add your work status",
    check: (p) =>
      hasText(p.employment_status) && p.employment_status !== "not_provided",
  },
];

/** Completion of a profile row, from the stored data only. */
export function calcProfileCompletion(profile: ProfileRow): ProfileCompletion {
  const items: CompletionItem[] = ITEM_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    complete: def.check(profile),
    hint: def.hint,
  }));
  const completed = items.filter((i) => i.complete).length;
  const total = items.length;
  const percent = Math.round((completed / total) * 100);
  const missing = items.filter((i) => !i.complete);
  return {
    percent,
    completed,
    total,
    items,
    missing,
    // The badge rule: verified ⟺ completion is exactly 100%.
    verified: percent === 100,
    nextStep: missing.length > 0 ? missing[0].hint : null,
  };
}

/* ---------------- level band progress ----------------
 *
 * Port of progressToNextLevel (web scoring.ts) with
 * calcLevelForScore / DEFAULT_LEVELS from @itg/calc inlined:
 * the bar shows progress through the CURRENT level's score
 * band. The score itself is the stored `user_levels` score —
 * the app never recomputes the multi-dimensional level score.
 */

export interface LevelThreshold {
  name: string;
  minScore: number;
  maxScore: number | null;
}

/** @itg/calc DEFAULT_LEVELS — used when the levels table read is empty. */
export const DEFAULT_LEVELS: LevelThreshold[] = [
  { name: "Bronze", minScore: 0, maxScore: 39 },
  { name: "Silver", minScore: 40, maxScore: 59 },
  { name: "Gold", minScore: 60, maxScore: 79 },
  { name: "Platinum", minScore: 80, maxScore: null },
];

function thresholdsFromLevels(levels: readonly LevelRowLite[]): LevelThreshold[] {
  if (levels.length === 0) return DEFAULT_LEVELS;
  return levels.map((l) => ({
    name: l.name,
    minScore: l.min_score,
    maxScore: l.max_score,
  }));
}

function calcLevelForScore(score: number, levels: LevelThreshold[]): string {
  const clamped = Math.max(0, score);
  for (const level of levels) {
    if (
      clamped >= level.minScore &&
      (level.maxScore === null || clamped <= level.maxScore)
    ) {
      return level.name;
    }
  }
  return levels[levels.length - 1].name;
}

export interface NextLevelProgress {
  currentLevel: string;
  nextLevel: string | null;
  /** Points of score needed to reach the next level. Null at the top level. */
  pointsToNext: number | null;
  /** 0–100 progress through the current level's band. */
  progressPct: number;
}

/**
 * Progress towards the next level. Null when there is no score
 * yet. At the top level (Platinum) the next level is null and
 * progress is 100.
 */
export function progressToNextLevel(
  score: number | null,
  levels: readonly LevelRowLite[],
): NextLevelProgress | null {
  if (score === null) return null;
  const thresholds = thresholdsFromLevels(levels);
  const current = calcLevelForScore(score, thresholds);
  const currentRow = thresholds.find((t) => t.name === current);
  const next = thresholds.find(
    (t) => currentRow !== undefined && t.minScore > currentRow.minScore,
  );
  if (!currentRow || !next) {
    return { currentLevel: current, nextLevel: null, pointsToNext: null, progressPct: 100 };
  }
  const bandTop = next.minScore;
  const bandBottom = currentRow.minScore;
  const progressPct =
    bandTop === bandBottom
      ? 100
      : Math.max(0, Math.min(100, ((score - bandBottom) / (bandTop - bandBottom)) * 100));
  return {
    currentLevel: current,
    nextLevel: next.name,
    pointsToNext: Math.round((next.minScore - score) * 10) / 10,
    progressPct: Math.round(progressPct * 10) / 10,
  };
}

/* ---------------- trading identity ----------------
 *
 * Port of lib/profile/identity.ts. The profile row stores no
 * markets / sessions / primary strategy, so Trading Identity
 * is derived from what exists: the active trading plan first,
 * then the caller's closed-trade history. Every helper
 * returns null / [] when its source data does not exist, and
 * the screen omits those rows.
 */

/** The trade fields the identity + stat derivations read. */
export interface ProfileTradeLite {
  pair: string;
  session: string | null;
  strategyName: string | null;
  pnl: number;
  rMultiple: number | null;
}

export const SESSION_LABELS: Record<string, string> = {
  asia: "Asia",
  london: "London",
  new_york: "New York",
  other: "Other",
};

export function sessionLabel(session: string): string {
  return SESSION_LABELS[session] ?? session;
}

/** Most frequent values first, ties broken alphabetically (deterministic). */
function topValues(values: readonly (string | null)[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null || value.trim() === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

/** Pairs the trader has actually traded, most frequent first. */
export function topPairs(trades: readonly ProfileTradeLite[], limit = 3): string[] {
  return topValues(
    trades.map((t) => t.pair),
    limit,
  );
}

/** The strategy used on the most closed trades, or null. */
export function mostUsedStrategy(trades: readonly ProfileTradeLite[]): string | null {
  const top = topValues(
    trades.map((t) => t.strategyName),
    1,
  );
  return top.length > 0 ? top[0] : null;
}

/** The session of the most closed trades, or null. */
export function mostTradedSession(trades: readonly ProfileTradeLite[]): string | null {
  const top = topValues(
    trades.map((t) => t.session),
    1,
  );
  return top.length > 0 ? top[0] : null;
}

/** Markets: the active plan's markets first, otherwise the pairs actually traded. */
export function identityMarkets(
  planMarkets: readonly string[] | null | undefined,
  trades: readonly ProfileTradeLite[],
): string[] {
  const planned = (planMarkets ?? []).filter((m) => m.trim() !== "");
  return planned.length > 0 ? [...planned] : topPairs(trades);
}

/** Sessions: the active plan's sessions first, otherwise the most-traded session. */
export function identitySessions(
  planSessions: readonly string[] | null | undefined,
  trades: readonly ProfileTradeLite[],
): string[] {
  const planned = (planSessions ?? []).filter(Boolean);
  if (planned.length > 0) return [...planned];
  const most = mostTradedSession(trades);
  return most === null ? [] : [most];
}

/* ---------------- profile stat strip ----------------
 *
 * Display reduces over the caller's CLOSED trades with a
 * stored P&L — the same trade set the web profile feeds
 * summarizeTrades (lib/analytics/analytics.ts), whose
 * definitions these mirror:
 * - Total trades: every row in the set counts (incl. breakeven).
 * - Win rate: share of the set with pnl > 0 (calcWinRate).
 * - Average R: mean of the non-null r_multiples.
 * Profit factor follows the brief's display rule: it is null
 * ("—") when there are no wins or no losses to divide by.
 * These are presentation reduces over stored columns only —
 * the app computes no trade's P&L, R or ROI.
 */

export interface ProfileStats {
  totalTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  avgR: number | null;
}

export function profileStats(trades: readonly ProfileTradeLite[]): ProfileStats {
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossProfit = wins.reduce((sum, p) => sum + p, 0);
  const grossLoss = Math.abs(losses.reduce((sum, p) => sum + p, 0));
  const rs = trades
    .map((t) => t.rMultiple)
    .filter((r): r is number => r !== null);
  return {
    totalTrades: trades.length,
    winRate: pnls.length === 0 ? null : (wins.length / pnls.length) * 100,
    profitFactor:
      grossLoss === 0 ? null : grossProfit / grossLoss,
    avgR: rs.length === 0 ? null : rs.reduce((sum, r) => sum + r, 0) / rs.length,
  };
}
