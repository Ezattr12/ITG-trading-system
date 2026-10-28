import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DISCIPLINE_LABELS,
  EMOTION_LABELS,
  MARKET_CONDITION_LABELS,
  SESSION_LABELS,
} from "@/lib/trades/validation";
import type { StrategyRow } from "@/lib/trades/types";
import type { TradeFilters } from "@/lib/trades/validation";

/**
 * Trade search + filters (Phase 3, spec §32).
 * A plain GET form: filters live in the URL, so a filtered
 * view is shareable and the back button works. All fields
 * optional.
 */

const selectClass = "input-select";

export function TradeFiltersForm({
  filters,
  strategies,
}: {
  filters: TradeFilters;
  strategies: StrategyRow[];
}) {
  return (
    <form method="get" action="/trades" className="card-surface p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" placeholder="Pair, strategy, setup, notes…" defaultValue={filters.q ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pair">Pair</Label>
          <Input id="pair" name="pair" placeholder="EUR/USD" defaultValue={filters.pair ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="direction">Long / Short</Label>
          <select id="direction" name="direction" defaultValue={filters.direction ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="strategyId">Strategy</Label>
          <select id="strategyId" name="strategyId" defaultValue={filters.strategyId ?? ""} className={selectClass}>
            <option value="">All</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="session">Session</Label>
          <select id="session" name="session" defaultValue={filters.session ?? ""} className={selectClass}>
            <option value="">All</option>
            {Object.entries(SESSION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="outcome">Win / Loss</Label>
          <select id="outcome" name="outcome" defaultValue={filters.outcome ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="win">Win</option>
            <option value="loss">Loss</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="marketCondition">Market condition</Label>
          <select id="marketCondition" name="marketCondition" defaultValue={filters.marketCondition ?? ""} className={selectClass}>
            <option value="">All</option>
            {Object.entries(MARKET_CONDITION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="emotion">Emotion</Label>
          <select id="emotion" name="emotion" defaultValue={filters.emotion ?? ""} className={selectClass}>
            <option value="">All</option>
            {Object.entries(EMOTION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="discipline">Discipline</Label>
          <select id="discipline" name="discipline" defaultValue={filters.discipline ?? ""} className={selectClass}>
            <option value="">All</option>
            {Object.entries(DISCIPLINE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confidence">Confidence</Label>
          <select id="confidence" name="confidence" defaultValue={filters.confidence ?? ""} className={selectClass}>
            <option value="">All</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <Button type="submit">Filter</Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/trades">Clear</Link>
        </Button>
      </div>
    </form>
  );
}
