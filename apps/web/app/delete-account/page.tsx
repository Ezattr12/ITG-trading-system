import Link from "next/link";
import { AmbientBackground } from "@/components/ambient-background";
import { DeletionRequestForm } from "@/components/account/account-forms";

export const metadata = { title: "Delete your account — ITG TraderOS" };

/**
 * Public account-deletion page (Google Play requirement:
 * a signed-out deletion-request path, linked from the store
 * listing and the Privacy Policy).
 *
 * Three deletion paths exist and this page names all of
 * them: in the app, signed in on the web, and this form.
 * The form records a request — it does NOT delete anything
 * by itself; an administrator verifies and processes
 * requests within 30 days. Its response is one uniform
 * message for every outcome, so the page can never reveal
 * whether an email address is registered.
 *
 * What deletion removes and the two disclosed retention
 * exceptions (audit entries kept with the account link
 * permanently removed; pre-deletion backups until rotation)
 * are stated here in the same words as the Privacy Policy.
 */
export default function DeleteAccountPage() {
  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 overflow-hidden px-6 py-16">
      <AmbientBackground />
      <header className="itg2-card itg2-card-flat motion-reveal relative p-6 sm:p-8">
        <p className="itg2-eyebrow">ITG TraderOS</p>
        <h1 className="itg2-page-title mt-2">Delete your account</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          You can delete your ITG TraderOS account and all of your data at any time. This page
          explains what deletion removes, the ways you can delete, and the request form for
          deleting without signing in.
        </p>
      </header>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="What deletion removes">
        <h2 className="itg2-section-title">What deletion removes</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            Deletion removes your profile, journal, trades, reviews, goals, progress,
            certificates, uploaded photos and screenshots, and your sign-in account. It is
            permanent and cannot be undone. Two narrow exceptions, kept only for security and
            audit integrity:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Security audit-log entries are retained with the link to your account permanently
              removed (the entry keeps the action, time, and IP address, but can no longer be
              associated with you).
            </li>
            <li>
              Backups and database snapshots taken before deletion may contain your data until
              they are rotated out in the ordinary backup cycle.
            </li>
          </ul>
        </div>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Ways to delete your account">
        <h2 className="itg2-section-title">Three ways to delete</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            <strong className="text-foreground">In the app:</strong> Profile → Delete account.
            Deletion is immediate after you confirm with your password.
          </li>
          <li>
            <strong className="text-foreground">Signed in on the web:</strong> Profile → Edit
            Profile → Delete account. Also immediate after password confirmation.
          </li>
          <li>
            <strong className="text-foreground">Without signing in:</strong> submit the request
            form below. Requests are verified and processed within 30 days.
          </li>
        </ul>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Request deletion">
        <h2 className="itg2-section-title">Request deletion</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Enter the email address of the account you want deleted. Submitting this form alone
          does not instantly delete your account — it records a request that we verify and
          process within 30 days. For immediate deletion, use one of the signed-in options
          above.
        </p>
        <div className="mt-5 max-w-md">
          <DeletionRequestForm />
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          See also the{" "}
          <Link href="/privacy" className="itg2-link">
            Privacy Policy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
