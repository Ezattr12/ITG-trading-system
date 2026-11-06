import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Google Play release preparation — structural pins for the
 * public privacy / deletion surfaces and their wiring, in
 * the same source-assertion style as the profile structure
 * and RLS-matrix guards:
 *
 * - /privacy and /delete-account are reachable signed out
 *   (middleware PUBLIC_PATHS) — the Play listing links them.
 * - The privacy page carries the audited facts: OCR on trade
 *   screenshots, the audit log's IP address and its retention
 *   with the account link permanently removed, backup
 *   rotation, Supabase + Vercel as processors, public avatars
 *   vs private screenshots, no ads/trackers/payments, 18+.
 * - The public deletion form carries the honeypot field and
 *   answers success with ONE uniform message (no
 *   account-existence oracle), and the page states the form
 *   alone does not instantly delete.
 * - The signed-in danger zone wires deleteOwnAccountAction
 *   with password + a `confirm` field.
 * - The admin queue page calls requireAdmin() BEFORE its
 *   service-role read (the Task 4 lesson: gate first, then
 *   data), and its controls wire processDeletionRequestAction.
 */

const webDir = join(process.cwd(), "apps/web");
const read = (rel: string) => readFileSync(join(webDir, rel), "utf8");

const middleware = read("middleware.ts");
const privacyPage = read("app/privacy/page.tsx");
const deleteAccountPage = read("app/delete-account/page.tsx");
const accountForms = read("components/account/account-forms.tsx");
const editPage = read("app/profile/edit/page.tsx");
const adminPage = read("app/admin/deletion-requests/page.tsx");
const adminForms = read("components/admin/deletion-request-forms.tsx");
const loginPage = read("app/login/page.tsx");

const UNIFORM_MESSAGE =
  "Thank you. If an account exists for this email address, a deletion request has been recorded. Requests are verified and processed within 30 days. For immediate deletion, sign in and use the deletion option in your profile — or delete from the mobile app under Profile.";

describe("Play surfaces: public routes", () => {
  it("middleware PUBLIC_PATHS contains /privacy and /delete-account", () => {
    const start = middleware.indexOf("const PUBLIC_PATHS");
    const end = middleware.indexOf("];", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const list = middleware.slice(start, end);
    expect(list).toContain('"/privacy"');
    expect(list).toContain('"/delete-account"');
  });
});

describe("Play surfaces: privacy policy facts", () => {
  it("carries the publication date and no invented contact", () => {
    expect(privacyPage).toContain("Last updated: November 6, 2026");
    expect(privacyPage).not.toContain("[SUPPORT EMAIL]");
    expect(privacyPage).toContain("Google Play store listing");
  });

  it("states what is collected, including OCR and the audit log's IP address", () => {
    for (const phrase of [
      "securely hashed password",
      "Text may be extracted from trade screenshots (OCR)",
      "IP",
      "address",
      "never collect bank, card, or payment details",
      "no broker connection for order execution",
    ]) {
      expect(privacyPage).toContain(phrase);
    }
  });

  it("states the non-collection facts", () => {
    for (const phrase of [
      "No advertising identifiers and no advertising",
      "advertising SDKs",
      "No analytics or tracking SDKs",
      "No payment information of any kind",
    ]) {
      expect(privacyPage).toContain(phrase);
    }
  });

  it("names the two processors and the storage split", () => {
    expect(privacyPage).toContain("Supabase");
    expect(privacyPage).toContain("Vercel");
    expect(privacyPage).toContain("public-read bucket");
    expect(privacyPage).toContain("short-lived signed links");
    expect(privacyPage).toContain("row-level security");
  });

  it("states the retention exceptions and every deletion path", () => {
    for (const phrase of [
      "link to your account permanently",
      "removed",
      "rotated out in the ordinary backup cycle",
      "Profile → Delete account",
      "/delete-account",
      "within 30 days",
      "adults (18+)",
    ]) {
      expect(privacyPage).toContain(phrase);
    }
  });
});

describe("Play surfaces: public deletion page", () => {
  it("names all three deletion paths", () => {
    expect(deleteAccountPage).toContain("Profile → Delete account");
    expect(deleteAccountPage).toContain("Profile → Edit");
    expect(deleteAccountPage).toContain("Delete account");
    expect(deleteAccountPage).toContain("Without signing in");
  });

  it("states the retention exceptions and that the form alone is not instant deletion", () => {
    expect(deleteAccountPage).toContain("permanently");
    expect(deleteAccountPage).toContain("removed");
    expect(deleteAccountPage).toContain("rotated out");
    expect(deleteAccountPage).toContain(
      "Submitting this form alone",
    );
    expect(deleteAccountPage).toContain("does not instantly delete your account");
  });

  it("the form carries the honeypot field, hidden from people", () => {
    expect(accountForms).toContain('name="website"');
    expect(accountForms).toContain("tabIndex={-1}");
    expect(accountForms).toContain('autoComplete="off"');
    expect(accountForms).toContain('aria-hidden="true"');
    expect(accountForms).toContain("requestDeletionAction");
    expect(accountForms).toContain('name="email"');
  });

  it("the success state is the one uniform message", () => {
    expect(accountForms).toContain(UNIFORM_MESSAGE);
  });
});

describe("Play surfaces: signed-in danger zone", () => {
  it("the edit page renders the delete-account form in its own section", () => {
    expect(editPage).toContain("DeleteOwnAccountForm");
    expect(editPage).toContain('aria-label="Delete account"');
    // The danger zone sits after the profile form's save flow.
    const formIdx = editPage.indexOf('submitLabel="Save changes"');
    const dangerIdx = editPage.indexOf('aria-label="Delete account"');
    expect(formIdx).toBeGreaterThan(-1);
    expect(dangerIdx).toBeGreaterThan(formIdx);
  });

  it("the delete form wires deleteOwnAccountAction with password + confirm fields", () => {
    expect(accountForms).toContain("deleteOwnAccountAction");
    expect(accountForms).toContain('name="password"');
    expect(accountForms).toContain('name="confirm"');
  });
});

describe("Play surfaces: login notice", () => {
  it("shows the deletion notice for account_deleted=1", () => {
    expect(loginPage).toContain("account_deleted");
    expect(loginPage).toContain("Your account has been deleted.");
    expect(loginPage).toContain("itg2-notice");
  });
});

describe("Play surfaces: admin queue", () => {
  it("calls requireAdmin() before the service-role read", () => {
    const gateIdx = adminPage.indexOf("await requireAdmin()");
    const readIdx = adminPage.indexOf("createServiceRoleSupabaseClient()");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(readIdx);
    expect(adminPage).toContain("account_deletion_requests");
  });

  it("the controls wire processDeletionRequestAction for both decisions", () => {
    expect(adminPage).toContain("DeletionRequestControls");
    expect(adminForms).toContain("processDeletionRequestAction");
    expect(adminForms).toContain('decision="process"');
    expect(adminForms).toContain('decision="dismiss"');
  });
});
