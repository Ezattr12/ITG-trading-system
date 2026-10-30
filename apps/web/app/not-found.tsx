import Link from "next/link";

/**
 * Custom 404 (Phase 27). Before this, an unknown route fell
 * back to the framework's unbranded default page. Signed-out
 * visitors never see this — middleware sends them to /login
 * first (see e2e/smoke.spec.ts); signed-in traders get a
 * branded dead end with a way back instead.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-2xl font-bold">This page doesn&apos;t exist</h1>
        <p className="text-sm text-muted-foreground">
          The page you were looking for was moved, deleted, or never existed.
          Your trades and journal are safe on the dashboard.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
