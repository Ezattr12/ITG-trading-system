import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Profile UI/UX Correction (Ezat, 2026-11-05) — structural
 * pins for the corrected Profile viewing/editing split, in
 * the same source-assertion style as the RSC-boundary and
 * RLS-matrix guards:
 *
 * - /profile is a read-only overview: no form fields, no
 *   avatar upload control, no "Tap the photo to change it"
 *   caption, no badge explainer paragraph.
 * - The ITG Verified badge renders beside the trader's name
 *   and only behind the canonical `completion.verified`
 *   condition (percent === 100 from the ONE calculator in
 *   @itg/calc — its own matrix is pinned in
 *   packages/calc/src/profile-completion.test.ts).
 * - Editing lives on /profile/edit: the moved form (same
 *   field names the updateProfileAction schema reads) and
 *   the existing AvatarUpload control.
 * - A successful save returns to /profile: the action
 *   returns redirectTo "/profile" (ActionForm navigates on
 *   it) and revalidates both routes.
 */

const webDir = join(process.cwd(), "apps/web");
const profilePage = readFileSync(join(webDir, "app/profile/page.tsx"), "utf8");
const editPage = readFileSync(join(webDir, "app/profile/edit/page.tsx"), "utf8");
const avatarUpload = readFileSync(
  join(webDir, "components/profile/avatar-upload.tsx"),
  "utf8",
);
const actions = readFileSync(join(webDir, "lib/auth/actions.ts"), "utf8");

const REMOVED_CAPTION = "Tap the photo to change it";
const REMOVED_EXPLAINER =
  "this badge confirms your profile information is complete";
const REMOVED_EXPLAINER_VARIANT = "It is a completeness badge";

describe("Profile correction: main page is read-only", () => {
  it("the photo caption string is gone from every profile surface", () => {
    expect(profilePage).not.toContain(REMOVED_CAPTION);
    expect(editPage).not.toContain(REMOVED_CAPTION);
    expect(avatarUpload).not.toContain(REMOVED_CAPTION);
  });

  it("the badge explainer paragraph is gone from the main page", () => {
    expect(profilePage).not.toContain(REMOVED_EXPLAINER);
    expect(profilePage).not.toContain(REMOVED_EXPLAINER_VARIANT);
    expect(profilePage).not.toContain("not identity (KYC) verification");
  });

  it("the main page renders no editable form machinery", () => {
    expect(profilePage).not.toContain("ActionForm");
    expect(profilePage).not.toContain("updateProfileAction");
    expect(profilePage).not.toContain("<Input");
    expect(profilePage).not.toContain("<select");
    expect(profilePage).not.toContain('id="edit-profile"');
  });

  it("the hero photo is the display-only component, never the upload control", () => {
    expect(profilePage).toContain("AvatarDisplay");
    expect(profilePage).not.toContain("AvatarUpload");
  });

  it("the main page keeps the read-only content the mandate lists", () => {
    for (const marker of [
      "Key stats",
      "Trading Identity",
      "Achievements",
      "Profile completion",
      'href="/levels"',
    ]) {
      expect(profilePage).toContain(marker);
    }
  });
});

describe("Profile correction: verified badge beside the name", () => {
  it("the badge is gated on the canonical completion.verified, exactly once", () => {
    // The badge element itself (the .itg2-verified pill)
    // renders in exactly one place on the page.
    expect(profilePage.match(/itg2-verified/g)).toHaveLength(1);
    expect(profilePage).toContain("completion.verified &&");
    // The badge condition reads the shared calculator's row —
    // no second percent computation on the page.
    expect(profilePage).toContain("calcProfileCompletion(");
    expect(profilePage).not.toContain("percent === 100");
  });

  it("the badge sits inside the name heading, immediately after the name", () => {
    const nameIdx = profilePage.indexOf('<h1 className="itg2-page-title">');
    const badgeIdx = profilePage.indexOf("itg2-verified");
    expect(nameIdx).toBeGreaterThan(-1);
    expect(badgeIdx).toBeGreaterThan(nameIdx);
    // Beside, not below: the badge element is inline in the
    // <h1> (flows with the name at every width), before the
    // role/country line renders.
    const roleIdx = profilePage.indexOf("Professional Trader");
    expect(badgeIdx).toBeLessThan(roleIdx);
  });

  it("an Edit Profile button links to the dedicated page", () => {
    expect(profilePage).toContain('href="/profile/edit"');
    expect(profilePage).toContain("Edit Profile");
  });
});

describe("Profile correction: the edit page carries the moved form", () => {
  it("renders the existing AvatarUpload control (no second upload system)", () => {
    expect(editPage).toContain("AvatarUpload");
    // The upload path itself is untouched: AvatarUpload still
    // posts to the one uploadAvatarAction over the shared core.
    const upload = readFileSync(
      join(webDir, "components/profile/avatar-upload.tsx"),
      "utf8",
    );
    expect(upload).toContain("uploadAvatarAction");
    expect(actions).toContain("uploadAvatarCore");
  });

  it("renders every field the update action's schema reads", () => {
    for (const name of [
      "fullName",
      "fatherName",
      "dateOfBirth",
      "country",
      "tradingExperience",
      "tradingEducation",
      "backtestedTrades",
      "realTradesCount",
      "employmentStatus",
      "tradingCapital",
      "monthlyIncome",
      "backtestingExperience",
      "realTradingExperience",
      "demoTrading",
      "tradesRealMoney",
    ]) {
      expect(editPage).toContain(`name="${name}"`);
    }
    expect(editPage).toContain("updateProfileAction");
    expect(editPage).toContain('submitLabel="Save changes"');
  });

  it("a successful save returns to /profile with both routes revalidated", () => {
    const start = actions.indexOf("export async function updateProfileAction");
    const end = actions.indexOf("export async function uploadAvatarAction");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = actions.slice(start, end);
    expect(body).toContain('redirectTo: "/profile"');
    expect(body).toContain('revalidatePath("/profile")');
    expect(body).toContain('revalidatePath("/profile/edit")');
    // The write still goes through the shared core with the
    // session user's id — no client-supplied identity.
    expect(body).toContain("updateProfileCore(supabase, user.id, parsed.data)");
  });
});
