"use client";

import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordGoalProgressAction } from "@/lib/discipline/actions";

/**
 * Manual progress form (Phase 6, spec §21).
 *
 * Only shown for goals the system cannot measure from trades or
 * activity (e.g. "other" goals, or a journal goal with no closed
 * trades yet). Measured goals update automatically and never show
 * this form — the trader is never asked to enter a value the
 * system can calculate.
 */
export function GoalProgressForm({
  goalId,
  currentValue,
}: {
  goalId: string;
  currentValue: number | null;
}) {
  return (
    <ActionForm action={recordGoalProgressAction} submitLabel="Record progress">
      <input type="hidden" name="goalId" value={goalId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`current-${goalId}`}>Current value</Label>
          <Input
            id={`current-${goalId}`}
            name="currentValue"
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 5"
            defaultValue={currentValue === null ? "" : String(currentValue)}
            className="min-h-[44px]"
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`note-${goalId}`}>Note (optional)</Label>
          <Input
            id={`note-${goalId}`}
            name="note"
            type="text"
            placeholder="How is it going?"
            maxLength={500}
            className="min-h-[44px]"
          />
        </div>
      </div>
    </ActionForm>
  );
}
