import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LessonRow,
  PsychologyRow,
  ScreenshotRow,
  StrategyRow,
  TradeDetail,
  TradeListItem,
  TradeRow,
} from "./types";

/**
 * Trade reads (Phase 3). Server Components call these with the
 * signed-in user's Supabase client, so RLS enforces isolation:
 * a trader can only ever read their own trades. No service-role
 * client is used for reads.
 *
 * The list fetch is capped at 500 most recent trades (see the
 * list page): in-memory filters for psychology / outcome run
 * over that set. Phase 12 pushes those filters into the query
 * if a trader's journal grows past it.
 */

export const TRADE_LIST_FETCH_LIMIT = 500;

export async function getSystemStrategies(
  supabase: SupabaseClient,
): Promise<StrategyRow[]> {
  const { data } = await supabase
    .from("strategies")
    .select("id, name, description, is_system")
    .eq("is_system", true)
    .order("name", { ascending: true });
  return (data ?? []) as StrategyRow[];
}

export async function getTradeListItems(
  supabase: SupabaseClient,
  userId: string,
  dbFilters: {
    pair?: string;
    direction?: "long" | "short";
    session?: string;
    marketCondition?: string;
    strategyId?: string;
    from?: string;
    to?: string;
  },
): Promise<TradeListItem[]> {
  let query = supabase
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .order("opened_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  if (dbFilters.pair) query = query.ilike("pair", `%${dbFilters.pair}%`);
  if (dbFilters.direction) query = query.eq("direction", dbFilters.direction);
  if (dbFilters.session) query = query.eq("session", dbFilters.session);
  if (dbFilters.marketCondition) query = query.eq("market_condition", dbFilters.marketCondition);
  if (dbFilters.strategyId) query = query.eq("strategy_id", dbFilters.strategyId);
  if (dbFilters.from) query = query.gte("opened_at", dbFilters.from);
  if (dbFilters.to) query = query.lte("opened_at", dbFilters.to);
  const { data: trades } = await query;
  const rows = (trades ?? []) as TradeRow[];
  if (rows.length === 0) return [];

  const tradeIds = rows.map((t) => t.id);
  const [{ data: psych }, { data: strategies }, { data: setups }] = await Promise.all([
    supabase.from("psychology_records").select("*").in("trade_id", tradeIds),
    supabase.from("strategies").select("id, name").in("id", rows.map((t) => t.strategy_id).filter(Boolean) as string[]),
    supabase.from("setups").select("id, name").in("id", rows.map((t) => t.setup_id).filter(Boolean) as string[]),
  ]);
  const psychByTrade = new Map<string, PsychologyRow>(
    ((psych ?? []) as PsychologyRow[]).map((p) => [p.trade_id as string, p]),
  );
  const strategyName = new Map<string, string>(
    ((strategies ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  const setupName = new Map<string, string>(
    ((setups ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  return rows.map((trade) => {
    const p = trade.id ? psychByTrade.get(trade.id) : undefined;
    return {
      trade,
      strategyName: trade.strategy_id ? strategyName.get(trade.strategy_id) ?? null : null,
      setupName: trade.setup_id ? setupName.get(trade.setup_id) ?? null : null,
      confidence: p?.confidence ?? null,
      emotion: p?.emotion ?? null,
      discipline: p?.discipline ?? null,
    };
  });
}

export async function getTradeDetail(
  supabase: SupabaseClient,
  userId: string,
  tradeId: string,
): Promise<TradeDetail | null> {
  const { data: trade } = await supabase
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!trade) return null;
  const t = trade as TradeRow;
  const [psychRes, lessonsRes, shotsRes, strategy, setup] = await Promise.all([
      supabase.from("psychology_records").select("*").eq("trade_id", tradeId).maybeSingle(),
      supabase.from("lessons").select("*").eq("trade_id", tradeId).order("created_at", { ascending: true }),
      supabase.from("trade_screenshots").select("*").eq("trade_id", tradeId).order("created_at", { ascending: true }),
      t.strategy_id
        ? supabase
            .from("strategies")
            .select("id, name")
            .eq("id", t.strategy_id)
            .maybeSingle()
            .then((r) => (r.data as { name?: string } | null) ?? null)
        : Promise.resolve(null),
      t.setup_id
        ? supabase
            .from("setups")
            .select("id, name")
            .eq("id", t.setup_id)
            .maybeSingle()
            .then((r) => (r.data as { name?: string } | null) ?? null)
        : Promise.resolve(null),
    ]);

  const psych = psychRes.data;
  const lessons = lessonsRes.data;
  const shots = shotsRes.data;

  let reversedTrade: TradeRow | null = null;
  let correctingTrade: TradeRow | null = null;
  if (t.status === "reversed" && t.reversal_trade_id) {
    const { data } = await supabase
      .from("trades")
      .select("*")
      .eq("id", t.reversal_trade_id)
      .eq("user_id", userId)
      .maybeSingle();
    correctingTrade = (data as TradeRow | null) ?? null;
  }
  if (t.status === "closed" || t.status === "open") {
    const { data } = await supabase
      .from("trades")
      .select("*")
      .eq("reversal_trade_id", t.id)
      .eq("user_id", userId)
      .maybeSingle();
    reversedTrade = (data as TradeRow | null) ?? null;
  }

  return {
    trade: t,
    strategyName: strategy?.name ?? null,
    setupName: setup?.name ?? null,
    psychology: (psych as PsychologyRow | null) ?? null,
    lessons: (lessons ?? []) as LessonRow[],
    screenshots: (shots ?? []) as ScreenshotRow[],
    reversedTrade,
    correctingTrade,
  };
}
