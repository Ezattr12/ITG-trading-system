"use client";

/**
 * Print button for the report page (Phase 8). Restyled to
 * the v2 ghost button in the Task 6 reports conversion —
 * behaviour and label unchanged.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="itg2-btn-ghost"
    >
      Print
    </button>
  );
}
