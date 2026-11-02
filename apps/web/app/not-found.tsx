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
      <div className="itg2-card itg2-card-flat w-full max-w-md space-y-4 p-8 text-center">
        <p className="itg2-eyebrow">404</p>
        <h1 className="text-2xl font-bold">This page doesn&apos;t exist</h1>
        <p className="text-sm text-muted-foreground">
          The page you were looking for was moved, deleted, or never existed.
          Your trades and journal are safe on the dashboard.
        </p>
        <Link href="/dashboard" className="itg2-btn-primary">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
