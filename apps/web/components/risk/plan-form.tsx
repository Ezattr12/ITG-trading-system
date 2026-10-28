"use client";

import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTradingPlanAction } from "@/lib/risk/actions";
import type { TradingPlan } from "@/lib/risk/types";
import type { TradingSession } from "@/lib/trades/types";

const SESSION_OPTIONS: { value: TradingSession; label: string }[] = [
  { value: "asia", label: "Asia" },
  { value: "london", label: "London" },
  { value: "new_york", label: "New York" },
  { value: "other", label: "Other" },
];

/**
 * Trading plan form (Phase 5, spec §20).
 *
 * Markets are a comma-separated list; sessions and preferred
 * setups are checkboxes. Saving replaces the trader's single
 * active plan (upsert in the Server Action).
 */
export function TradingPlanForm({
  plan,
  setups,
}: {
  plan: TradingPlan | null;
  setups: { id: string; name: string; strategyName: string | null }[];
}) {
  const inputClass = "min-h-[44px]";
  const value = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  return (
    <ActionForm action={saveTradingPlanAction} submitLabel="Save trading plan">
      <div className="space-y-2">
        <Label htmlFor="name">Plan name</Label>
        <Input
          id="name"
          name="name"
          required
          placeholder="My Trading Plan"
          defaultValue={plan?.name ?? "My Trading Plan"}
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="markets">Markets (comma-separated)</Label>
        <Input
          id="markets"
          name="markets"
          placeholder="EUR/USD, XAU/USD, BTC/USD"
          defaultValue={(plan?.markets ?? []).join(", ")}
          className={inputClass}
          autoComplete="off"
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sessions</legend>
        <div className="flex flex-wrap gap-4">
          {SESSION_OPTIONS.map((s) => (
            <label key={s.value} className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="sessions"
                value={s.value}
                defaultChecked={(plan?.sessions ?? []).includes(s.value)}
                className="h-4 w-4"
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="riskPerTradePct">Risk per trade (%)</Label>
          <Input
            id="riskPerTradePct"
            name="riskPerTradePct"
            type="number"
            step="any"
            min="0.1"
            max="100"
            placeholder="e.g. 1"
            defaultValue={value(plan?.risk_per_trade_pct)}
            className={inputClass}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxDailyLoss">Max daily loss</Label>
          <Input
            id="maxDailyLoss"
            name="maxDailyLoss"
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 200"
            defaultValue={value(plan?.max_daily_loss)}
            className={inputClass}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxDailyTrades">Max daily trades</Label>
          <Input
            id="maxDailyTrades"
            name="maxDailyTrades"
            type="number"
            step="1"
            min="1"
            max="100"
            placeholder="e.g. 5"
            defaultValue={value(plan?.max_daily_trades)}
            className={inputClass}
            inputMode="numeric"
          />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Preferred setups</legend>
        {setups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No setups yet — add setups to a strategy in your journal first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {setups.map((s) => (
              <label key={s.id} className="flex min-h-[44px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="preferredSetupIds"
                  value={s.id}
                  defaultChecked={(plan?.preferred_setup_ids ?? []).includes(s.id)}
                  className="h-4 w-4"
                />
                {s.strategyName ? `${s.strategyName} — ${s.name}` : s.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="noTradeConditions">No-trade conditions</Label>
        <textarea
          id="noTradeConditions"
          name="noTradeConditions"
          rows={3}
          placeholder="e.g. No trading during major news, no trading after 2 losses in a row"
          defaultValue={plan?.no_trade_conditions ?? ""}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="psychologyRules">Psychology rules</Label>
        <textarea
          id="psychologyRules"
          name="psychologyRules"
          rows={3}
          placeholder="e.g. Stop after feeling FOMO, review the journal before the next session"
          defaultValue={plan?.psychology_rules ?? ""}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="scheduleNotes">Trading schedule</Label>
        <Input
          id="scheduleNotes"
          name="scheduleNotes"
          placeholder="e.g. Mon–Fri, 08:00–11:00 London session"
          defaultValue={plan?.schedule?.notes ?? ""}
          className={inputClass}
        />
      </div>
    </ActionForm>
  );
}
