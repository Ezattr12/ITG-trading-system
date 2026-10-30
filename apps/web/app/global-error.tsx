"use client";

/**
 * Root-layout error boundary (Phase 27). This renders INSTEAD
 * of the root layout when the layout itself fails, so it
 * cannot rely on globals.css, Tailwind, or the self-hosted
 * font — everything is inline, using the app's palette values
 * (globals.css: background hsl(270 100% 6%), foreground
 * hsl(272 25% 94%), primary hsl(262 83% 58%)). Last-resort UI:
 * if this shows, the only safe action offered is a full reload.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: "#0d0217",
          color: "#efeaf6",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div style={{ maxWidth: "28rem", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: "0.875rem", opacity: 0.75, lineHeight: 1.6 }}>
              ITG TraderOS hit an unexpected error before the page could load.
              Your data is stored safely — reloading usually clears this.
            </p>
            {error.digest ? (
              <p style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                Reference: <span style={{ fontFamily: "monospace" }}>{error.digest}</span>
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "1rem",
                minHeight: "2.75rem",
                padding: "0 1.25rem",
                borderRadius: "0.375rem",
                border: "none",
                backgroundColor: "#7c3aed",
                color: "#ffffff",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
