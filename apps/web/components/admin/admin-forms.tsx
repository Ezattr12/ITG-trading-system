"use client";

/**
 * Admin forms (Phase 10) — role / verification / certificate
 * revocation / financial-view request / achievement / level /
 * setting editors, all submitting to lib/admin/actions via the
 * shared ActionForm.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * fields moved onto the v2 form system (.itg2-field wrappers,
 * .itg2-label, .itg2-input / .itg2-select — the auth/profile
 * pattern of shadcn controls kept + the v2 class) and submits
 * onto the v2 buttons via ActionForm's submitClassName (blue
 * primary for saves; .itg2-btn-danger for the destructive
 * certificate revocation). The shared ActionForm itself is
 * untouched, exactly as on every converted sibling. All
 * actions, field names, ids, defaults, option values and copy
 * are exactly as before.
 */
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeUserRoleAction,
  changeVerificationAction,
  requestFinancialViewAction,
  revokeCertificateAction,
  saveAchievementAction,
  saveLevelThresholdAction,
  saveSystemSettingAction,
} from "@/lib/admin/actions";
import type { AdminAchievementRow, AdminLevelRow } from "@/lib/admin/types";

const inputClass = "itg2-input";
const selectClass = "itg2-select";

function ReasonField({ id }: { id: string }) {
  return (
    <div className="itg2-field space-y-2">
      <Label htmlFor={id} className="itg2-label">Reason (recorded in the audit log)</Label>
      <Input id={id} name="reason" type="text" placeholder="e.g. Verified payout statement" className={inputClass} />
    </div>
  );
}

export function RoleForm({ userId, currentRole }: { userId: string; currentRole: string }) {
  return (
    <ActionForm action={changeUserRoleAction} submitLabel="Change role" submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="userId" value={userId} />
      <div className="itg2-field space-y-2">
        <Label htmlFor={`role-${userId}`} className="itg2-label">Role</Label>
        <select id={`role-${userId}`} name="role" defaultValue={currentRole} className={selectClass}>
          <option value="trader">Trader</option>
          <option value="admin">Admin</option>
          <option value="auditor">Auditor (read-only)</option>
        </select>
      </div>
      <ReasonField id={`role-reason-${userId}`} />
    </ActionForm>
  );
}

export function VerificationForm({
  userId,
  currentStatus,
}: {
  userId: string;
  currentStatus: string;
}) {
  return (
    <ActionForm action={changeVerificationAction} submitLabel="Change verification" submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="userId" value={userId} />
      <div className="itg2-field space-y-2">
        <Label htmlFor={`verification-${userId}`} className="itg2-label">Verification status</Label>
        <select
          id={`verification-${userId}`}
          name="verificationStatus"
          defaultValue={currentStatus}
          className={selectClass}
        >
          <option value="not_provided">Not provided</option>
          <option value="partial">Partial</option>
          <option value="verified">Verified</option>
        </select>
      </div>
      <ReasonField id={`verification-reason-${userId}`} />
    </ActionForm>
  );
}

export function RevokeCertificateForm({ certificateId }: { certificateId: string }) {
  return (
    <ActionForm action={revokeCertificateAction} submitLabel="Revoke certificate" submitClassName="itg2-btn-danger w-full">
      <input type="hidden" name="certificateId" value={certificateId} />
      <ReasonField id={`revoke-reason-${certificateId}`} />
      <p className="text-xs text-muted-foreground">
        Revoking is permanent for this certificate and is recorded in the audit log.
      </p>
    </ActionForm>
  );
}

export function FinancialViewForm({ userId }: { userId: string }) {
  return (
    <ActionForm action={requestFinancialViewAction} submitLabel="Request financial view" submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="userId" value={userId} />
      <ReasonField id={`financial-reason-${userId}`} />
      <p className="text-xs text-muted-foreground">
        Financial data (trading capital, income, historical P&amp;L) is shown for 15 minutes
        only, and this request is recorded in the audit log.
      </p>
    </ActionForm>
  );
}

export function AchievementForm({ achievement }: { achievement?: AdminAchievementRow }) {
  return (
    <ActionForm
      action={saveAchievementAction}
      submitLabel={achievement ? "Update achievement" : "Create achievement"}
      submitClassName="itg2-btn-primary itg2-btn-save"
    >
      <input type="hidden" name="id" value={achievement?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="itg2-field space-y-2">
          <Label htmlFor={`ach-name-${achievement?.id ?? "new"}`} className="itg2-label">Name</Label>
          <Input
            id={`ach-name-${achievement?.id ?? "new"}`}
            name="name"
            type="text"
            defaultValue={achievement?.name ?? ""}
            className={inputClass}
          />
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor={`ach-slug-${achievement?.id ?? "new"}`} className="itg2-label">Slug</Label>
          <Input
            id={`ach-slug-${achievement?.id ?? "new"}`}
            name="slug"
            type="text"
            defaultValue={achievement?.slug ?? ""}
            placeholder="e.g. first-trade"
            className={inputClass}
          />
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor={`ach-category-${achievement?.id ?? "new"}`} className="itg2-label">Category</Label>
          <select
            id={`ach-category-${achievement?.id ?? "new"}`}
            name="category"
            defaultValue={achievement?.category ?? "other"}
            className={selectClass}
          >
            {["trades", "discipline", "journal", "risk", "backtesting", "goals", "consistency", "other"].map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor={`ach-xp-${achievement?.id ?? "new"}`} className="itg2-label">XP reward</Label>
          <Input
            id={`ach-xp-${achievement?.id ?? "new"}`}
            name="xpReward"
            type="number"
            min="0"
            defaultValue={String(achievement?.xp_reward ?? 0)}
            className={inputClass}
          />
        </div>
        <div className="itg2-field space-y-2 sm:col-span-2">
          <Label htmlFor={`ach-desc-${achievement?.id ?? "new"}`} className="itg2-label">Description</Label>
          <Input
            id={`ach-desc-${achievement?.id ?? "new"}`}
            name="description"
            type="text"
            defaultValue={achievement?.description ?? ""}
            className={inputClass}
          />
        </div>
      </div>
    </ActionForm>
  );
}

export function LevelForm({ level }: { level: AdminLevelRow }) {
  return (
    <ActionForm action={saveLevelThresholdAction} submitLabel="Update thresholds" submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="levelId" value={level.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="itg2-field space-y-2">
          <Label htmlFor={`level-min-${level.id}`} className="itg2-label">Min score</Label>
          <Input
            id={`level-min-${level.id}`}
            name="minScore"
            type="number"
            step="any"
            min="0"
            max="100"
            defaultValue={String(level.min_score)}
            className={inputClass}
          />
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor={`level-max-${level.id}`} className="itg2-label">Max score (blank = no upper limit)</Label>
          <Input
            id={`level-max-${level.id}`}
            name="maxScore"
            type="number"
            step="any"
            min="0"
            max="100"
            defaultValue={level.max_score === null ? "" : String(level.max_score)}
            className={inputClass}
          />
        </div>
      </div>
    </ActionForm>
  );
}

export function SettingForm({
  settingKey,
  value,
  label,
  hint,
}: {
  settingKey: string;
  value: string;
  label: string;
  hint: string;
}) {
  return (
    <ActionForm action={saveSystemSettingAction} submitLabel={`Save ${label}`} submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="key" value={settingKey} />
      <div className="itg2-field space-y-2">
        <Label htmlFor={`setting-${settingKey}`} className="itg2-label">{label}</Label>
        <Input
          id={`setting-${settingKey}`}
          name="value"
          type="text"
          defaultValue={value}
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </ActionForm>
  );
}
