import {
  calcDurationSeconds,
  calcPnl,
  calcRiskAmount,
  calcRiskReward,
  calcRMultiple,
  calcRoi,
  isWin,
  type Direction,
} from "@itg/calc";
import type { QuickTradeInput } from "./validation";

/**
 * Server-side trade metrics (Phase 3, spec §9).
 *
 * The trader enters entry / exit / TP / SL / size / leverage /
 * date-time only. Everything below is computed here, in the
 * Server Action, from those inputs — never entered by the trader
 * and never trusted from the client. Open trades have no P&L
 * yet: every calculated field is null until the trade closes.
 */

export interface TradeMetrics {
  status: "open" | "closed";
  pnl: number | null;
  roiPct: number | null;
  rMultiple: number | null;
  riskReward: number | null;
  isWin: boolean | null;
  durationSeconds: number | null;
}

export function computeTradeMetrics(input: QuickTradeInput): TradeMetrics {
  const closed = input.exitPrice !== null && input.closedAt !== null;
  if (!closed) {
    return {
      status: "open",
      pnl: null,
      roiPct: null,
      rMultiple: null,
      riskReward: null,
      isWin: null,
      durationSeconds: null,
    };
  }
  const direction: Direction = input.direction;
  const pnl = calcPnl({
    direction,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice as number,
    positionSize: input.positionSize,
    fees: input.fees ?? 0,
  });
  const riskAmount = calcRiskAmount({
    entryPrice: input.entryPrice,
    stopLoss: input.sl,
    positionSize: input.positionSize,
  });
  return {
    status: "closed",
    pnl,
    roiPct: calcRoi({
      pnl,
      entryPrice: input.entryPrice,
      positionSize: input.positionSize,
      leverage: input.leverage,
    }),
    rMultiple: calcRMultiple({ pnl, riskAmount }),
    riskReward: calcRiskReward({
      direction,
      entryPrice: input.entryPrice,
      stopLoss: input.sl,
      takeProfit: input.tp,
    }),
    isWin: isWin(pnl),
    durationSeconds: calcDurationSeconds(input.openedAt, input.closedAt),
  };
}

/** "2h 15m", "45m", "30s" — for the trade detail page. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** Signed, 2-decimal money for display. Null stays "—" (not 0). */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
