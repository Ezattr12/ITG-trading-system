import { headers } from "next/headers";
import { AmbientBackground } from "@/components/ambient-background";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getCertificateVerification } from "@/lib/certificates/verification";
import { monthLabel } from "@/lib/certificates/eligibility";

export const metadata = {
  title: "Verify a certificate — ITG TraderOS",
  robots: { index: false },
};

/**
 * Public certificate verification (Task 24).
 *
 * Anyone holding a certificate ID can confirm it here, signed
 * out — that is the point of verification. The page reads ONE
 * certificate through the service-role client (certificates
 * have no anonymous RLS policy, so the table is not enumerable
 * through the API) and renders only the certificate's own
 * public facts: holder name as stored, what it certifies, the
 * issue date and the status. No email, no trade data, no P&L —
 * see lib/certificates/verification.ts for the whitelist.
 *
 * Abuse posture matches the app's other public surfaces: the
 * in-memory limiter in lib/auth/rate-limit.ts (per-instance,
 * best-effort) throttles checks per source address, and the
 * answer for an unknown id is one uniform "not verified" —
 * identical for a mistyped id and a fabricated one. A revoked
 * certificate verifies as revoked, never as valid.
 *
 * ITG certificates are internal credentials: issued by ITG
 * TraderOS against ITG's own standards. The page says so —
 * nothing here claims an external qualification or
 * accreditation.
 */

const VERIFY_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 overflow-hidden px-6 py-16">
      <AmbientBackground />
      <section className="itg2-hero motion-reveal relative">
        <div className="itg2-hero-rings" aria-hidden="true" />
        <div className="itg2-hero-inner p-6 sm:p-8">
          <p className="itg2-eyebrow">Certificate verification</p>
          <h1 className="itg2-page-title mt-2">Verify a certificate</h1>
          {children}
        </div>
      </section>
      <p className="text-center text-sm text-muted-foreground">
        ITG certificates are internal credentials, issued by ITG TraderOS
        against ITG&apos;s own standards. They are not external qualifications
        or accreditations.
      </p>
    </main>
  );
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const { certificateId } = await params;
  const id = decodeURIComponent(certificateId).trim();

  // Throttle before touching the database. Per-instance and
  // best-effort — the same documented posture as the auth
  // limiter it shares code with.
  const headerList = await headers();
  const source =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rate = checkRateLimit(
    `verify:${source}`,
    VERIFY_RATE_LIMIT.limit,
    VERIFY_RATE_LIMIT.windowMs,
  );
  if (!rate.allowed) {
    return (
      <Shell>
        <p className="page-lede mt-3 text-lg">
          Too many verification checks from this connection. Please wait a
          minute and try again.
        </p>
      </Shell>
    );
  }

  const admin = isSupabaseConfigured() ? createServiceRoleSupabaseClient() : null;
  if (!admin) {
    return (
      <Shell>
        <p className="page-lede mt-3 text-lg">
          Verification is unavailable right now — the certificate registry
          cannot be reached. Nothing about the certificate can be confirmed
          or denied in this state.
        </p>
      </Shell>
    );
  }

  const result = await getCertificateVerification(admin, id);
  const verified = result.found && result.status === "issued";

  if (!verified) {
    return (
      <Shell>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {result.found && result.status === "revoked" ? (
            <span className="itg2-chip itg2-chip-loss">Revoked</span>
          ) : (
            <span className="itg2-chip itg2-chip-muted">Not verified</span>
          )}
        </div>
        <p className="page-lede mt-3 text-lg">
          {result.found && result.status === "revoked"
            ? `Certificate ${id} was issued by ITG TraderOS and has been revoked. It is no longer valid.`
            : `Certificate ${id} could not be verified. It may not exist, or the ID may have been entered incorrectly.`}
        </p>
      </Shell>
    );
  }

  const certifies =
    result.kind === "level"
      ? `ITG Level Certificate — assessed at the ${result.levelName ?? "Level"} band${
          result.assessedAt ? ` on ${longDate(result.assessedAt)}` : ""
        }. This records the assessment on that date; it does not by itself state the trader's current level.`
      : `ITG Performance Certificate — ${result.month ? monthLabel(result.month) : "monthly"}.`;

  return (
    <Shell>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="itg2-chip itg2-chip-gold">Verified</span>
        <span className="itg2-chip">Issued by ITG TraderOS</span>
      </div>
      <dl className="mt-5 space-y-3 text-sm sm:text-base">
        <div>
          <dt className="text-muted-foreground">Certificate ID</dt>
          <dd className="font-medium tnum">{result.certificateId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Holder</dt>
          <dd className="font-medium">{result.traderName ?? "Name not provided"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Certifies</dt>
          <dd className="font-medium">{certifies}</dd>
        </div>
        {result.issuedAt ? (
          <div>
            <dt className="text-muted-foreground">Issued</dt>
            <dd className="font-medium">{longDate(result.issuedAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium capitalize">{result.status}</dd>
        </div>
      </dl>
    </Shell>
  );
}
