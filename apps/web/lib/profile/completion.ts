/**
 * Profile completion — re-export shim.
 *
 * The calculator has ONE canonical implementation:
 * `packages/calc/src/profile-completion.ts` in `@itg/calc`,
 * shared by web and mobile (mobile deep-imports that file via
 * its vendored copy). This module exists only so existing
 * `@/lib/profile/completion` imports keep working — do NOT add
 * logic here. The product rule (the ITG Verified Profile badge
 * shows if and only if completion is 100% of the 8 stored
 * items; a completeness badge, not identity/KYC verification)
 * is documented in the canonical module.
 */
export {
  calcProfileCompletion,
  PROFILE_VERIFIED_THRESHOLD,
  type CompletionItem,
  type ProfileCompletion,
  type ProfileCompletionRow,
} from "@itg/calc";
