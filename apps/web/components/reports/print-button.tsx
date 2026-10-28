"use client";

/** Print button for the report page (Phase 8). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border px-3 py-1.5 text-sm font-medium"
    >
      Print
    </button>
  );
}
