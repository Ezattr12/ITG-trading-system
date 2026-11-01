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
 *
 * Master Web UI Redesign Page 6 — PRESENTATION ONLY: fields
 * moved onto the Page 2 v2 form system (.itg2-field /
 * .itg2-label / .itg2-input / .itg2-select) and the submit
 * uses .itg2-btn-primary .itg2-btn-save via ActionForm's
 * submitClassName. Every field name, option value and label,
 * default, placeholder and the action are untouched. Used
 * only by the goals page.
 */
export function GoalForm() {
  const inputClass = "itg2-input";
  return (
    <ActionForm action={createGoalAction} submitLabel="Create goal" submitClassName="itg2-btn-primary itg2-btn-save">
      <div className="itg2-field space-y-2">
        <Label className="itg2-label" htmlFor="title">Goal title</Label>
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
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="period">Period</Label>
          <select id="period" name="period" defaultValue="monthly" className="itg2-select">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="goalType">What is measured</Label>
          <select id="goalType" name="goalType" defaultValue="max_trades" className="itg2-select">
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
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="targetValue">Target</Label>
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
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="targetUnit">Unit (optional)</Label>
          <Input
            id="targetUnit"
            name="targetUnit"
            type="text"
            placeholder="e.g. trades, hours"
            maxLength={40}
            className={inputClass}
          />
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" className={inputClass} />
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="endDate">End date (optional)</Label>
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
