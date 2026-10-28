"use client";

/** Print button for the report page (Phase 8). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center rounded-md border bg-card px-3 py-1.5 text-sm font-medium shadow-elevation-1 transition-all duration-fast ease-standard hover:bg-accent hover:shadow-elevation-2"
    >
      Print
    </button>
  );
}
