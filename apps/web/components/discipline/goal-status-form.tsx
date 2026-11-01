"use client";

import { ActionForm } from "@/components/auth/action-form";
import { updateGoalStatusAction } from "@/lib/discipline/actions";
import type { GoalStatus } from "@/lib/discipline/types";

/**
 * Change a goal's status (Phase 6, spec §21).
 *
 * Master Web UI Redesign Page 6 — PRESENTATION ONLY: the
 * select moved onto the Page 2 v2 form system (.itg2-select)
 * and the submit uses .itg2-btn-primary .itg2-btn-save via
 * ActionForm's submitClassName — the same full-width primary
 * emphasis the form has always had. The status is still
 * chosen in the select and committed by the one "Update
 * status" action; the option values and the action are
 * untouched. Used only by the goals page.
 */
export function GoalStatusForm({
  goalId,
  status,
}: {
  goalId: string;
  status: GoalStatus;
}) {
  return (
    <ActionForm action={updateGoalStatusAction} submitLabel="Update status" submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="goalId" value={goalId} />
      <label className="sr-only" htmlFor={`status-${goalId}`}>
        Goal status
      </label>
      <select
        id={`status-${goalId}`}
        name="status"
        defaultValue={status}
        className="itg2-select"
      >
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="completed">Completed</option>
        <option value="failed">Failed</option>
      </select>
    </ActionForm>
  );
}
