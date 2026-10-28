/**
 * ITG TraderOS — pure trade / performance calculations.
 *
 * All money math goes through decimal.js. Inputs may be numbers or
 * numeric strings; results are plain numbers (converted from Decimal
 * only at the boundary) or `null` where the value is undefined
 * (e.g. R multiple with no risk). No I/O, no Supabase, no dates
 * fetched from anywhere — pure functions, fully unit-tested.
 *
 * P&L / ROI / R / risk-reward are computed by the system from the
 * trade's entry, exit, size, fees, SL and TP. The trader never enters
 * them (spec §9).
 */

import Decimal from "decimal.js";

export type Direction = "long" | "short";

const D = (value: number | string): Decimal => new Decimal(value);

function toNumber(value: Decimal): number {
  return value.toNumber();
}

/** P&L of a closed trade: (exit - entry) * size for long, reversed for short, minus fees. */
export function calcPnl(input: {
  direction: Direction;
  entryPrice: number | string;
  exitPrice: number | string;
  positionSize: number | string;
  fees?: number | string;
}): number {
  const entry = D(input.entryPrice);
  const exit = D(input.exitPrice);
  const size = D(input.positionSize);
  const fees = D(input.fees ?? 0);
  const diff = input.direction === "long" ? exit.minus(entry) : entry.minus(exit);
  return toNumber(diff.times(size).minus(fees));
}

/** Amount risked on a trade: |entry - SL| * size. Null when SL is missing. */
export function calcRiskAmount(input: {
  entryPrice: number | string;
  stopLoss: number | string | null | undefined;
  positionSize: number | string;
}): number | null {
  if (input.stopLoss === null || input.stopLoss === undefined) return null;
  return toNumber(D(input.entryPrice).minus(D(input.stopLoss)).abs().times(D(input.positionSize)));
}

/**
 * ROI (%) against the capital actually deployed.
 * invested = entry * size / leverage (leverage defaults to 1).
 * Null when invested is zero or negative.
 */
export function calcRoi(input: {
  pnl: number | string;
  entryPrice: number | string;
  positionSize: number | string;
  leverage?: number | string;
}): number | null {
  const invested = D(input.entryPrice)
    .times(D(input.positionSize))
    .dividedBy(D(input.leverage ?? 1));
  if (invested.lte(0)) return null;
  return toNumber(D(input.pnl).dividedBy(invested).times(100));
}

/** R multiple: P&L divided by risk. Null when risk is missing or <= 0. */
export function calcRMultiple(input: {
  pnl: number | string;
  riskAmount: number | string | null | undefined;
}): number | null {
  if (input.riskAmount === null || input.riskAmount === undefined) return null;
  const risk = D(input.riskAmount);
  if (risk.lte(0)) return null;
  return toNumber(D(input.pnl).dividedBy(risk));
}

/**
 * Risk/reward ratio: potential reward (|TP - entry|) / risk (|entry - SL|).
 * Null when TP or SL is missing, or risk is zero.
 */
export function calcRiskReward(input: {
  direction: Direction;
  entryPrice: number | string;
  stopLoss: number | string | null | undefined;
  takeProfit: number | string | null | undefined;
}): number | null {
  if (input.stopLoss === null || input.stopLoss === undefined) return null;
  if (input.takeProfit === null || input.takeProfit === undefined) return null;
  const entry = D(input.entryPrice);
  const risk = entry.minus(D(input.stopLoss)).abs();
  if (risk.lte(0)) return null;
  const reward = D(input.takeProfit).minus(entry).abs();
  // Direction does not change the ratio (both legs use absolute distance),
  // but keep the parameter so callers cannot silently mix up long/short.
  void input.direction;
  return toNumber(reward.dividedBy(risk));
}

export function isWin(pnl: number | string): boolean {
  return D(pnl).gt(0);
}

/** Whole seconds between open and close. Null when either is missing. */
export function calcDurationSeconds(
  openedAt: string | Date | null | undefined,
  closedAt: string | Date | null | undefined,
): number | null {
  if (!openedAt || !closedAt) return null;
  const seconds = Math.floor(
    (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 1000,
  );
  return seconds >= 0 ? seconds : null;
}

/** Win rate (%) over a list of trade P&Ls. Null when there are no trades. */
export function calcWinRate(pnls: ReadonlyArray<number | string>): number | null {
  if (pnls.length === 0) return null;
  const wins = pnls.filter((p) => D(p).gt(0)).length;
  return toNumber(new Decimal(wins).dividedBy(pnls.length).times(100));
}

export function calcAvgWin(pnls: ReadonlyArray<number | string>): number | null {
  const wins = pnls.filter((p) => D(p).gt(0));
  if (wins.length === 0) return null;
  return toNumber(
    wins.reduce((sum, p) => sum.plus(D(p)), new Decimal(0)).dividedBy(wins.length),
  );
}

export function calcAvgLoss(pnls: ReadonlyArray<number | string>): number | null {
  const losses = pnls.filter((p) => D(p).lt(0));
  if (losses.length === 0) return null;
  return toNumber(
    losses.reduce((sum, p) => sum.plus(D(p)), new Decimal(0)).dividedBy(losses.length),
  );
}

/**
 * Profit factor: gross profit / gross loss (as a positive number).
 * Null when there is no gross loss (no losing trades) — the factor is
 * then unbounded, and callers must display it as such, not as infinity.
 */
export function calcProfitFactor(pnls: ReadonlyArray<number | string>): number | null {
  const grossProfit = pnls
    .filter((p) => D(p).gt(0))
    .reduce((sum, p) => sum.plus(D(p)), new Decimal(0));
  const grossLoss = pnls
    .filter((p) => D(p).lt(0))
    .reduce((sum, p) => sum.plus(D(p).abs()), new Decimal(0));
  if (grossLoss.eq(0)) return null;
  return toNumber(grossProfit.dividedBy(grossLoss));
}

/** Expectancy: average P&L per trade. Null when there are no trades. */
export function calcExpectancy(pnls: ReadonlyArray<number | string>): number | null {
  if (pnls.length === 0) return null;
  return toNumber(
    pnls.reduce((sum, p) => sum.plus(D(p)), new Decimal(0)).dividedBy(pnls.length),
  );
}

/**
 * Maximum drawdown (absolute currency units) over an equity curve.
 * The curve is a list of equity values in chronological order.
 * Returns 0 for an empty or never-declining curve.
 */
export function calcMaxDrawdown(equityCurve: ReadonlyArray<number | string>): number {
  let peak = new Decimal(0);
  let maxDd = new Decimal(0);
  let first = true;
  for (const value of equityCurve) {
    const equity = D(value);
    if (first) {
      peak = equity;
      first = false;
      continue;
    }
    if (equity.gt(peak)) peak = equity;
    const dd = peak.minus(equity);
    if (dd.gt(maxDd)) maxDd = dd;
  }
  return toNumber(maxDd);
}

/** Current consecutive win/loss streak: positive = wins, negative = losses, 0 = none. */
export function calcCurrentStreak(pnls: ReadonlyArray<number | string>): number {
  if (pnls.length === 0) return 0;
  let streak = 0;
  for (let i = pnls.length - 1; i >= 0; i -= 1) {
    const pnl = D(pnls[i]);
    if (pnl.eq(0)) break;
    const sign = pnl.gt(0) ? 1 : -1;
    if (streak === 0) streak = sign;
    else if (Math.sign(streak) !== sign) break;
    else streak += sign;
  }
  return streak;
}

// ---------------------------------------------------------------- XP & levels

export type XpAction =
  | "trade_journal"
  | "daily_goal"
  | "backtest_session"
  | "weekly_review"
  | "risk_discipline"
  | "achievement";

/** XP awarded per action, spec §24. Bad behaviour reduces XP only via
 *  explicit, logged penalty transactions — never silently. */
export const XP_TABLE: Record<XpAction, number> = {
  trade_journal: 10,
  daily_goal: 20,
  backtest_session: 15,
  weekly_review: 30,
  risk_discipline: 25,
  achievement: 0, // achievements carry their own xp_reward (see achievements table)
};

export function calcXpFor(action: XpAction): number {
  return XP_TABLE[action];
}

export type LevelName = "Bronze" | "Silver" | "Gold" | "Platinum";

export interface LevelThreshold {
  name: LevelName;
  minScore: number;
  maxScore: number | null;
}

/** Default thresholds (configurable in the levels table, Phase 7). */
export const DEFAULT_LEVELS: LevelThreshold[] = [
  { name: "Bronze", minScore: 0, maxScore: 39 },
  { name: "Silver", minScore: 40, maxScore: 59 },
  { name: "Gold", minScore: 60, maxScore: 79 },
  { name: "Platinum", minScore: 80, maxScore: null },
];

export function calcLevelForScore(score: number, levels: LevelThreshold[] = DEFAULT_LEVELS): LevelName {
  const clamped = Math.max(0, score);
  for (const level of levels) {
    if (clamped >= level.minScore && (level.maxScore === null || clamped <= level.maxScore)) {
      return level.name;
    }
  }
  return levels[levels.length - 1].name;
}

/** Goal progress: returns current, target and percentage (0–100+, uncapped). */
export function calcGoalProgress(input: {
  current: number | string;
  target: number | string;
}): { current: number; target: number; percent: number } | null {
  const target = D(input.target);
  if (target.lte(0)) return null;
  const current = D(input.current);
  return {
    current: toNumber(current),
    target: toNumber(target),
    percent: toNumber(current.dividedBy(target).times(100)),
  };
}

// ---------------------------------------------------------------- Equity curve / drawdown (Phase 4)

/**
 * Equity curve: cumulative P&L after each closed trade, in the order
 * given (callers pass trades sorted by close time). Starts at 0 —
 * the trader's starting capital is not stored, so the curve shows
 * cumulative trading P&L, never a fabricated balance.
 */
export function calcEquityCurve(pnls: ReadonlyArray<number | string>): number[] {
  const curve: number[] = [];
  let running = new Decimal(0);
  for (const p of pnls) {
    running = running.plus(D(p));
    curve.push(toNumber(running));
  }
  return curve;
}

/** One point of a drawdown series: equity, running peak, and drawdown from peak. */
export interface DrawdownPoint {
  equity: number;
  peak: number;
  drawdown: number;
}

/**
 * Drawdown series for an equity curve: the running peak and the
 * fall from it at each point. Empty curve → empty series.
 */
export function calcDrawdownSeries(equityCurve: ReadonlyArray<number | string>): DrawdownPoint[] {
  const points: DrawdownPoint[] = [];
  let peak = new Decimal(0);
  let first = true;
  for (const value of equityCurve) {
    const equity = D(value);
    if (first) {
      peak = equity;
      first = false;
    } else if (equity.gt(peak)) {
      peak = equity;
    }
    points.push({
      equity: toNumber(equity),
      peak: toNumber(peak),
      drawdown: toNumber(peak.minus(equity)),
    });
  }
  return points;
}

/** R-distribution bucket labels, spec §18. */
export const R_BUCKETS = [
  "< -2R",
  "-2 to -1R",
  "-1 to 0R",
  "0 to 1R",
  "1 to 2R",
  "> 2R",
] as const;

export type RBucket = (typeof R_BUCKETS)[number];

/** Which R bucket a trade's R multiple falls in. Null R (no SL) → null. */
export function calcRBucket(rMultiple: number | string | null | undefined): RBucket | null {
  if (rMultiple === null || rMultiple === undefined) return null;
  const r = D(rMultiple).toNumber();
  if (r < -2) return "< -2R";
  if (r < -1) return "-2 to -1R";
  if (r < 0) return "-1 to 0R";
  if (r < 1) return "0 to 1R";
  if (r < 2) return "1 to 2R";
  return "> 2R";
}

/** Counts per R bucket over a list of R multiples (nulls counted separately). */
export function calcRDistribution(
  rMultiples: ReadonlyArray<number | string | null | undefined>,
): { buckets: { label: RBucket; count: number }[]; noR: number } {
  const counts = new Map<RBucket, number>(R_BUCKETS.map((b) => [b, 0]));
  let noR = 0;
  for (const r of rMultiples) {
    const bucket = calcRBucket(r);
    if (bucket === null) noR += 1;
    else counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return { buckets: R_BUCKETS.map((label) => ({ label, count: counts.get(label) ?? 0 })), noR };
}
