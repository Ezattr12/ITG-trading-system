import Link from "next/link";
import { AmbientBackground } from "@/components/ambient-background";

export const metadata = { title: "Privacy Policy — ITG TraderOS" };

/**
 * Privacy Policy (Google Play release preparation).
 *
 * Public and signed-out by design — it is linked from the
 * Google Play store listing and must be readable without an
 * account, so /privacy sits in the middleware PUBLIC_PATHS.
 * The text is the audited policy for the production system:
 * what the app actually collects, the two service providers
 * (Supabase, Vercel), and the deletion paths with their two
 * disclosed retention exceptions. No contact address is
 * published here because none exists yet — the Contact
 * section says honestly how questions can be raised instead
 * of inventing one.
 */
export default function PrivacyPolicyPage() {
  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 overflow-hidden px-6 py-16">
      <AmbientBackground />
      <header className="itg2-card itg2-card-flat motion-reveal relative p-6 sm:p-8">
        <p className="itg2-eyebrow">ITG TraderOS</p>
        <h1 className="itg2-page-title mt-2">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: November 6, 2026</p>
        <p className="mt-4 text-sm leading-6">
          ITG TraderOS (&ldquo;TraderOS&rdquo;, &ldquo;the app&rdquo;) is a trading journal and
          performance management application operated by ITG — Institutional Trading Group
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy describes what data the app collects,
          why, how it is handled, and how you can delete it. It applies to the ITG TraderOS
          Android app and the web application at https://itg-traderos.vercel.app.
        </p>
      </header>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="What we collect">
        <h2 className="itg2-section-title">1. What we collect</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            <strong className="text-foreground">Account information.</strong> When you create an
            account we store your email address and a securely hashed password (authentication
            is provided by Supabase Auth). Your profile may also contain your full name,
            father&rsquo;s name, date of birth, country, a profile photo, and background details
            you choose to provide: trading experience, trading education, and employment status.
          </p>
          <p>
            <strong className="text-foreground">Your trading journal.</strong> Everything you
            record in the app is stored so the app can work for you: trades (instrument, prices,
            position size, leverage, fees, profit/loss, dates, notes), trading plans and risk
            rules, goals, weekly and monthly reviews, lessons, strategies and setups, backtesting
            session counts, and self-reported psychology records (the emotion, confidence, and
            discipline rating you attach to a trade).
          </p>
          <p>
            <strong className="text-foreground">Financial figures you enter.</strong> Optional
            fields such as trading capital and monthly income exist only to personalise your
            profile and progress calculations. We never collect bank, card, or payment details,
            and the app cannot move money: TraderOS has no broker connection for order execution
            and cannot place trades, deposit, transfer, or withdraw funds.
          </p>
          <p>
            <strong className="text-foreground">Photos you upload.</strong> A profile photo, and
            screenshots you attach to trades. Text may be extracted from trade screenshots (OCR)
            inside the app to help fill your journal; the extracted text is stored with the
            screenshot record and is visible only to you.
          </p>
          <p>
            <strong className="text-foreground">Progress and analysis data the app generates.</strong>{" "}
            Experience points, levels and level assessments, achievements, certificates, in-app
            notifications, and AI-coach insights. Insights are produced by the app&rsquo;s own
            analysis of your journal data on our servers — your data is not sent to advertisers
            or data brokers.
          </p>
          <p>
            <strong className="text-foreground">Technical and security records.</strong> Our
            servers keep an audit log of security-relevant actions (such as sign-ins, data
            changes, and account deletion requests), which includes the action, time, and IP
            address. Your sign-in session is stored on your device in encrypted device storage
            (Android Keystore-backed SecureStore). If you enable the biometric app lock, your
            device&rsquo;s operating system checks your fingerprint or face on the device itself —
            we never receive, store, or process biometric data.
          </p>
        </div>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="What we do not collect">
        <h2 className="itg2-section-title">2. What we do NOT collect</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            No advertising identifiers and no advertising. The app contains no ads and no
            advertising SDKs.
          </li>
          <li>
            No analytics or tracking SDKs, no crash-reporting services, and no cross-app or
            cross-site tracking.
          </li>
          <li>
            No precise location, contacts, calendar, microphone, or camera data. The app can
            access your photo library only when you choose a photo to upload.
          </li>
          <li>No payment information of any kind.</li>
        </ul>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="How we use your data">
        <h2 className="itg2-section-title">3. How we use your data</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your data is used only to operate the app for you: keeping your journal, calculating
          your performance, risk, discipline and progress statistics, generating your reports and
          coaching insights, issuing your certificates, securing your account, and preventing
          abuse. We do not sell personal data. We do not share personal data with third parties
          for marketing.
        </p>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Service providers">
        <h2 className="itg2-section-title">4. Service providers</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          We use two infrastructure providers that process data on our behalf, under their own
          security and privacy terms:
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            <strong className="text-foreground">Supabase</strong> — database, authentication, and
            file storage hosting.
          </li>
          <li>
            <strong className="text-foreground">Vercel</strong> — web application and API hosting.
          </li>
        </ul>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Security">
        <h2 className="itg2-section-title">5. Security</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Data is encrypted in transit (TLS). Access to your journal is enforced per user by
          database row-level security: your account can only ever read or write your own records.
          Profile photos are stored in a public-read bucket (so your photo can be displayed);
          trade screenshots are stored privately and are accessible only to you through
          short-lived signed links.
        </p>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Retention and account deletion">
        <h2 className="itg2-section-title">6. Retention and account deletion</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
          <p>Your data is kept while your account exists. You can delete your account at any time:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-foreground">In the app:</strong> Profile → Delete account.
            </li>
            <li>
              <strong className="text-foreground">On the web:</strong> sign in at
              https://itg-traderos.vercel.app and use the account deletion option in your profile
              settings.
            </li>
            <li>
              <strong className="text-foreground">Without signing in:</strong> submit a request at{" "}
              <Link href="/delete-account" className="itg2-link">
                https://itg-traderos.vercel.app/delete-account
              </Link>
            </li>
          </ul>
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
          <p>
            If you submit a deletion request through the public web form, we verify and process
            requests within 30 days.
          </p>
        </div>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Your choices">
        <h2 className="itg2-section-title">7. Your choices</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          You can edit or remove most profile information at any time in Edit Profile. Optional
          profile fields can be left blank. You can turn the biometric lock on or off on the
          sign-in screen.
        </p>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Children">
        <h2 className="itg2-section-title">8. Children</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          TraderOS is a professional trading tool intended for adults (18+). It is not directed
          at children, and we do not knowingly collect data from children.
        </p>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Changes to this policy">
        <h2 className="itg2-section-title">9. Changes to this policy</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          If this policy changes materially, we will update this page and the &ldquo;Last
          updated&rdquo; date before the change takes effect.
        </p>
      </section>

      <section className="itg2-card motion-reveal relative p-6 sm:p-8" aria-label="Contact">
        <h2 className="itg2-section-title">10. Contact</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Questions about this policy or your data can be raised through the account deletion /
          data request page at{" "}
          <Link href="/delete-account" className="itg2-link">
            /delete-account
          </Link>
          , and via the contact listed on the ITG TraderOS Google Play store listing. You can
          also request account deletion at{" "}
          <Link href="/delete-account" className="itg2-link">
            https://itg-traderos.vercel.app/delete-account
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
