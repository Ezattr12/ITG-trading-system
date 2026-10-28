"use client";

import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGoalAction } from "@/lib/discipline/actions";

/**
 * Goal creation form (Phase 6, spec §21).
 *
 * Daily / weekly / monthly / yearly goals. The target is a plain
 * number with a free-text unit (e.g. "trades", "hours"). Progress
 * is measured from real trades and activity where the goal type
 * allows it — the trader never enters progress the system can
 * calculate; manual goals are recorded separately.
 */
export function GoalForm() {
  const inputClass = "min-h-[44px]";
  return (
    <ActionForm action={createGoalAction} submitLabel="Create goal">
      <div className="space-y-2">
        <Label htmlFor="title">Goal title</Label>
        <Input
          id="title"
          name="title"
          type="text"
          placeholder="e.g. Journal 15 trades this month"
          maxLength={120}
          className={inputClass}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="period">Period</Label>
          <select id="period" name="period" defaultValue="monthly" className="input-select">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="goalType">What is measured</Label>
          <select id="goalType" name="goalType" defaultValue="max_trades" className="input-select">
            <option value="max_trades">Trades opened</option>
            <option value="journal_completion">Trades journaled</option>
            <option value="study_hours">Study hours</option>
            <option value="backtesting_sessions">Backtesting sessions</option>
            <option value="trading_sessions">Trading sessions</option>
            <option value="risk_discipline">Disciplined trades (SL set, leverage within limit)</option>
            <option value="performance_target">Profit target</option>
            <option value="other">Something else (tracked manually)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="targetValue">Target</Label>
          <Input
            id="targetValue"
            name="targetValue"
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 15"
            className={inputClass}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="targetUnit">Unit (optional)</Label>
          <Input
            id="targetUnit"
            name="targetUnit"
            type="text"
            placeholder="e.g. trades, hours"
            maxLength={40}
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" className={inputClass} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End date (optional)</Label>
          <Input id="endDate" name="endDate" type="date" className={inputClass} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Goals measured from your trades and activity update
        automatically. “Something else” goals are tracked by the
        progress you record yourself — nothing is ever guessed.
      </p>
    </ActionForm>
  );
}
