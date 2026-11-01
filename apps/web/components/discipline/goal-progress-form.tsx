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
 *
 * Master Web UI Redesign Page 6 — PRESENTATION ONLY: fields
 * moved onto the Page 2 v2 form system (.itg2-field /
 * .itg2-label / .itg2-input) and the submit uses
 * .itg2-btn-primary .itg2-btn-save via ActionForm's
 * submitClassName — the same full-width primary emphasis the
 * form has always had. Field names, defaults and the action
 * are untouched. Used only by the goals page.
 */
export function GoalProgressForm({
  goalId,
  currentValue,
}: {
  goalId: string;
  currentValue: number | null;
}) {
  return (
    <ActionForm action={recordGoalProgressAction} submitLabel="Record progress" submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="goalId" value={goalId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor={`current-${goalId}`}>Current value</Label>
          <Input
            id={`current-${goalId}`}
            name="currentValue"
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 5"
            defaultValue={currentValue === null ? "" : String(currentValue)}
            className="itg2-input"
            inputMode="decimal"
          />
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor={`note-${goalId}`}>Note (optional)</Label>
          <Input
            id={`note-${goalId}`}
            name="note"
            type="text"
            placeholder="How is it going?"
            maxLength={500}
            className="itg2-input"
          />
        </div>
      </div>
    </ActionForm>
  );
}
