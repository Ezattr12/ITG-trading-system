import type { TradeFilters } from "./validation";
import type { TradeListItem } from "./types";

/**
 * Trade list filtering (Phase 3, spec §32).
 *
 * Pure functions, fully unit-tested. The page applies the
 * database-friendly filters (pair, direction, session, market
 * condition, date range, strategy) in the Supabase query, then
 * applies these in-memory filters (search text, outcome,
 * psychology, confidence, discipline, setup name) to the fetched
 * page — the psychology / outcome data lives on joined rows, not
 * on the trades table. The 500-row fetch cap is documented on
 * the list page; Phase 12 pushes these filters into the query.
 */

export function applyTradeFilters(
  items: TradeListItem[],
  filters: TradeFilters,
): TradeListItem[] {
  const q = filters.q?.trim().toLowerCase() ?? "";
  const pair = filters.pair?.trim().toUpperCase() ?? "";
  return items.filter(({ trade, strategyName, setupName, confidence, emotion, discipline }) => {
    if (q) {
      const haystack = `${trade.pair} ${strategyName ?? ""} ${setupName ?? ""} ${trade.notes ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (pair && !trade.pair.toUpperCase().includes(pair)) return false;
    if (filters.direction && trade.direction !== filters.direction) return false;
    if (filters.strategyId && trade.strategy_id !== filters.strategyId) return false;
    if (filters.setup && !(setupName ?? "").toLowerCase().includes(filters.setup.toLowerCase())) return false;
    if (filters.session && trade.session !== filters.session) return false;
    if (filters.marketCondition && trade.market_condition !== filters.marketCondition) return false;
    if (filters.outcome && filters.outcome !== "all") {
      if (trade.is_win === null) return false;
      if (filters.outcome === "win" && trade.is_win !== true) return false;
      if (filters.outcome === "loss" && trade.is_win !== false) return false;
    }
    if (filters.confidence !== undefined && confidence !== filters.confidence) return false;
    if (filters.emotion && emotion !== filters.emotion) return false;
    if (filters.discipline && discipline !== filters.discipline) return false;
    if (filters.from && trade.opened_at < filters.from) return false;
    if (filters.to && trade.opened_at > filters.to) return false;
    return true;
  });
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export function paginate<T>(items: T[], page: number, perPage: number): PageResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    total,
    page: safePage,
    perPage,
    totalPages,
  };
}
