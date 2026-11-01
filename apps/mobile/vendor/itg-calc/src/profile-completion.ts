/**
 * Profile completion + the "ITG Verified Profile" badge.
 *
 * THE single source of truth for profile completion (Profile
 * Correction pass, step 2). This module is the ONLY implementation
 * of the calculation in the product:
 * - Web imports it from `@itg/calc` (apps/web/lib/profile/
 *   completion.ts is a thin re-export shim kept so existing
 *   import paths keep working — it contains no logic).
 * - Mobile deep-imports THIS file
 *   (`@itg/calc/src/profile-completion`, via the vendored copy
 *   produced by apps/mobile/scripts/vendor-calc.mjs) so Metro
 *   never pulls in the decimal.js modules that share the package.
 * - The input is the stored profile row itself, in its snake_case
 *   column shape, so every surface feeds the calculator the exact
 *   same values — no per-surface field mapping that could drift.
 *
 * Pure functions, no I/O, no Supabase, no fake data, and no
 * dependencies (in particular no decimal.js — completion is
 * counting, not money math).
 *
 * The badge is a PROFILE-COMPLETENESS badge, not identity/KYC
 * verification: it becomes active only when every required piece
 * of professional profile information is actually present in the
 * stored profile row. It is computed from data on every render —
 * nothing here is stored, nothing is settable by the trader, and
 * the admin-reviewed `verification_status` (Phase 11, migration
 * 0015: only an admin can change it) is a separate status shown
 * elsewhere on the profile. The architecture keeps the two apart
 * so a future real identity-verification status can be added
 * without touching this calculation.
 *
 * Required items (8): the fields the profile model already
 * collects and the product needs for a professional identity.
 * Trading style / preferred markets are NOT required here —
 * they are not stored on the profile row, so requiring them
 * would make the badge unreachable. They are shown on the
 * profile from the trader's active trading plan / trade history
 * instead (see the web app's `identity.ts`).
 *
 * RULE (product definition): the ITG Verified Profile badge is shown
 * if and only if calcProfileCompletion(...).percent === 100, derived
 * from the stored profile row at read time. It is never stored, never
 * settable by the trader or an admin, and appears/disappears
 * automatically as completion crosses 100%. It is a completeness
 * badge only — NOT identity, KYC, or government verification. Every
 * surface (web profile, dashboard, mobile profile) derives it
 * from this same 8-item calculation over the same columns. Note the
 * deliberate distinction from onboarding: onboarding step 4 counts an
 * explicit 'not_provided' as an answered step so onboarding can
 * finish; PROFILE completion requires a real work status — and the
 * field is editable on the profile surfaces so the requirement is
 * always reachable.
 */

/**
 * The stored profile row, restricted to the 8 columns the
 * calculation reads. Structural: any row type carrying these
 * columns (the web `ProfileRow`, the mobile `ProfileRow`, a raw
 * Supabase row) is accepted as-is.
 */
export interface ProfileCompletionRow {
  full_name: string | null | undefined;
  father_name: string | null | undefined;
  date_of_birth: string | null | undefined;
  country: string | null | undefined;
  avatar_url: string | null | undefined;
  trading_experience: string | null | undefined;
  trading_education: string | null | undefined;
  /** `employment_status` column; "not_provided" means unanswered. */
  employment_status: string | null | undefined;
}

export interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  /** What to do when this item is missing. */
  hint: string;
}

export interface ProfileCompletion {
  /** 0–100, whole percent. */
  percent: number;
  completed: number;
  total: number;
  items: CompletionItem[];
  missing: CompletionItem[];
  /** True only when every required item is complete. */
  verified: boolean;
  /** The first missing item's hint, or null when complete. */
  nextStep: string | null;
}

/** The badge activates only at full completion of the required items. */
export const PROFILE_VERIFIED_THRESHOLD = 100;

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const ITEM_DEFS: {
  key: string;
  label: string;
  hint: string;
  check: (p: ProfileCompletionRow) => boolean;
}[] = [
  {
    key: "full_name",
    label: "Full name",
    hint: "Add your full name",
    check: (p) => hasText(p.full_name),
  },
  {
    key: "avatar_url",
    label: "Profile photo",
    hint: "Add a profile photo",
    check: (p) => hasText(p.avatar_url),
  },
  {
    key: "father_name",
    label: "Father's name",
    hint: "Add your father's name",
    check: (p) => hasText(p.father_name),
  },
  {
    key: "date_of_birth",
    label: "Date of birth",
    hint: "Add your date of birth",
    check: (p) => hasText(p.date_of_birth),
  },
  {
    key: "country",
    label: "Country",
    hint: "Add your country",
    check: (p) => hasText(p.country),
  },
  {
    key: "trading_experience",
    label: "Trading experience",
    hint: "Add your trading experience",
    check: (p) => hasText(p.trading_experience),
  },
  {
    key: "trading_education",
    label: "Trading education",
    hint: "Add your trading education",
    check: (p) => hasText(p.trading_education),
  },
  {
    key: "employment_status",
    label: "Work status",
    hint: "Add your work status",
    check: (p) =>
      hasText(p.employment_status) && p.employment_status !== "not_provided",
  },
];

/** Completion of a profile row, from the stored data only. */
export function calcProfileCompletion(
  input: ProfileCompletionRow,
): ProfileCompletion {
  const items: CompletionItem[] = ITEM_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    complete: def.check(input),
    hint: def.hint,
  }));
  const completed = items.filter((i) => i.complete).length;
  const total = items.length;
  const percent = Math.round((completed / total) * 100);
  const missing = items.filter((i) => !i.complete);
  return {
    percent,
    completed,
    total,
    items,
    missing,
    verified: percent >= PROFILE_VERIFIED_THRESHOLD,
    nextStep: missing.length > 0 ? missing[0].hint : null,
  };
}
