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
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * fields moved onto the Page-2 form system (.itg2-field /
 * .itg2-label / .itg2-input / .itg2-textarea) and the submit
 * uses .itg2-btn-primary .itg2-btn-save via ActionForm's
 * submitClassName. Hairline dividers mark the risk-limits
 * and rules groups where the flat field list allows it
 * without wrapping elements (a bordered fieldset would put
 * the line through its legend) — no field was added,
 * removed, renamed, reordered or given a new default; the
 * checkbox groups keep their exact name/value/
 * defaultChecked semantics.
 */
export function TradingPlanForm({
  plan,
  setups,
}: {
  plan: TradingPlan | null;
  setups: { id: string; name: string; strategyName: string | null }[];
}) {
  const inputClass = "itg2-input";
  const value = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  return (
    <ActionForm action={saveTradingPlanAction} submitLabel="Save trading plan" submitClassName="itg2-btn-primary itg2-btn-save">
      <div className="itg2-field space-y-2">
        <Label className="itg2-label" htmlFor="name">Plan name</Label>
        <Input
          id="name"
          name="name"
          required
          placeholder="My Trading Plan"
          defaultValue={plan?.name ?? "My Trading Plan"}
          className={inputClass}
        />
      </div>
      <div className="itg2-field space-y-2">
        <Label className="itg2-label" htmlFor="markets">Markets (comma-separated)</Label>
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
        <legend className="itg2-label">Sessions</legend>
        <div className="flex flex-wrap gap-4">
          {SESSION_OPTIONS.map((s) => (
            <label key={s.value} className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="sessions"
                value={s.value}
                defaultChecked={(plan?.sessions ?? []).includes(s.value)}
                className="h-4 w-4 accent-primary"
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 border-t border-[rgba(120,175,255,0.1)] pt-4 sm:grid-cols-3">
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="riskPerTradePct">Risk per trade (%)</Label>
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
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="maxDailyLoss">Max daily loss</Label>
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
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="maxDailyTrades">Max daily trades</Label>
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
        <legend className="itg2-label">Preferred setups</legend>
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
                  className="h-4 w-4 accent-primary"
                />
                {s.strategyName ? `${s.strategyName} — ${s.name}` : s.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="itg2-field space-y-2 border-t border-[rgba(120,175,255,0.1)] pt-4">
        <Label className="itg2-label" htmlFor="noTradeConditions">No-trade conditions</Label>
        <textarea
          id="noTradeConditions"
          name="noTradeConditions"
          rows={3}
          placeholder="e.g. No trading during major news, no trading after 2 losses in a row"
          defaultValue={plan?.no_trade_conditions ?? ""}
          className="itg2-textarea"
        />
      </div>
      <div className="itg2-field space-y-2">
        <Label className="itg2-label" htmlFor="psychologyRules">Psychology rules</Label>
        <textarea
          id="psychologyRules"
          name="psychologyRules"
          rows={3}
          placeholder="e.g. Stop after feeling FOMO, review the journal before the next session"
          defaultValue={plan?.psychology_rules ?? ""}
          className="itg2-textarea"
        />
      </div>
      <div className="itg2-field space-y-2">
        <Label className="itg2-label" htmlFor="scheduleNotes">Trading schedule</Label>
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
