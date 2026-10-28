"use client";

import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveRiskRulesAction } from "@/lib/risk/actions";
import type { RiskRules } from "@/lib/risk/types";

/**
 * Risk rules form (Phase 5, spec §19).
 *
 * Every limit is optional — a blank field means "no limit set"
 * and the engine skips that check. Saving replaces the trader's
 * single active rules row (upsert in the Server Action).
 */
export function RiskRulesForm({ rules }: { rules: RiskRules | null }) {
  const inputClass = "min-h-[44px]";
  const value = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  return (
    <ActionForm action={saveRiskRulesAction} submitLabel="Save risk rules">
      <p className="text-sm text-muted-foreground">
        Leave a field blank to turn that rule off. Breaches are
        warnings in your journal — the daily loss limit and maximum
        leverage are the only two that stop a trade from being saved.
        Nothing here closes or executes a real trade.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="maxRiskPerTradePct">Max risk per trade (%)</Label>
          <Input
            id="maxRiskPerTradePct"
            name="maxRiskPerTradePct"
            type="number"
            step="any"
            min="0.1"
            max="100"
            placeholder="e.g. 1"
            defaultValue={value(rules?.max_risk_per_trade_pct)}
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
            defaultValue={value(rules?.max_daily_loss)}
            className={inputClass}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxTradesPerDay">Max trades per day</Label>
          <Input
            id="maxTradesPerDay"
            name="maxTradesPerDay"
            type="number"
            step="1"
            min="1"
            max="100"
            placeholder="e.g. 5"
            defaultValue={value(rules?.max_trades_per_day)}
            className={inputClass}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxConsecutiveLosses">Max consecutive losses</Label>
          <Input
            id="maxConsecutiveLosses"
            name="maxConsecutiveLosses"
            type="number"
            step="1"
            min="1"
            max="50"
            placeholder="e.g. 3"
            defaultValue={value(rules?.max_consecutive_losses)}
            className={inputClass}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxLeverage">Max leverage (×)</Label>
          <Input
            id="maxLeverage"
            name="maxLeverage"
            type="number"
            step="any"
            min="1"
            max="500"
            placeholder="e.g. 10"
            defaultValue={value(rules?.max_leverage)}
            className={inputClass}
            inputMode="decimal"
          />
        </div>
      </div>
    </ActionForm>
  );
}
