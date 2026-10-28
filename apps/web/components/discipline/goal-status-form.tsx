"use client";

import { ActionForm } from "@/components/auth/action-form";
import { updateGoalStatusAction } from "@/lib/discipline/actions";
import type { GoalStatus } from "@/lib/discipline/types";

/** Change a goal's status (Phase 6, spec §21). */
export function GoalStatusForm({
  goalId,
  status,
}: {
  goalId: string;
  status: GoalStatus;
}) {
  return (
    <ActionForm action={updateGoalStatusAction} submitLabel="Update status">
      <input type="hidden" name="goalId" value={goalId} />
      <label className="sr-only" htmlFor={`status-${goalId}`}>
        Goal status
      </label>
      <select
        id={`status-${goalId}`}
        name="status"
        defaultValue={status}
        className="min-h-[44px] w-full rounded-md border bg-background px-3 text-sm"
      >
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="completed">Completed</option>
        <option value="failed">Failed</option>
      </select>
    </ActionForm>
  );
}
