"use client";

import { useEffect } from "react";

/**
 * Route error boundary (Phase 27). Before this, an unhandled
 * render/action error fell back to the framework's default
 * error page. This boundary keeps the trader inside the app:
 * a plain explanation, the framework error digest (a
 * correlation id, never a stack trace) for support, and a
 * retry that re-renders the segment. The error itself is
 * logged to the browser console only — no error-tracking
 * service is connected yet (see docs/phase-27.md, surface 10).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          This page hit an unexpected error. Nothing was saved or changed by
          the failure itself — try again, and if it keeps happening, note the
          reference below.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
