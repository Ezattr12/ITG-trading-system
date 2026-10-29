import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avatarFileError, MAX_AVATAR_SIZE_BYTES } from "./avatar-validation";

describe("avatarFileError", () => {
  it("rejects a missing or empty file", () => {
    expect(avatarFileError(null)).toBe("Choose an image file first.");
    expect(avatarFileError({ type: "image/png", size: 0 })).toBe(
      "Choose an image file first.",
    );
  });

  it("rejects non-image files", () => {
    expect(avatarFileError({ type: "text/plain", size: 600 })).toBe(
      "Only image files can be used as a profile photo.",
    );
    expect(avatarFileError({ type: "application/pdf", size: 600 })).toBe(
      "Only image files can be used as a profile photo.",
    );
  });

  it("accepts images up to and including 2 MB", () => {
    expect(avatarFileError({ type: "image/jpeg", size: 52_201 })).toBeNull();
    expect(
      avatarFileError({ type: "image/png", size: MAX_AVATAR_SIZE_BYTES }),
    ).toBeNull();
  });

  it("rejects images above 2 MB with the graceful message", () => {
    expect(
      avatarFileError({
        type: "image/jpeg",
        size: MAX_AVATAR_SIZE_BYTES + 1,
      }),
    ).toBe("Profile photo must be 2 MB or smaller.");
    expect(avatarFileError({ type: "image/jpeg", size: 3_085_124 })).toBe(
      "Profile photo must be 2 MB or smaller.",
    );
  });
});

/**
 * Regression guard for the 2026-10-29 production crash
 * (Digest 3390255549): Next.js Server Actions default to a 1 MB
 * request-body limit, which sat below the app's own upload
 * limits (avatar 2 MB, trade screenshots 5 MB) — any file in
 * between was rejected by the framework with a thrown 413
 * before the action's validation could run, crashing the page.
 * The configured framework limit must stay above the largest
 * app upload limit, or the crash comes back.
 */
describe("serverActions bodySizeLimit guard", () => {
  it("next.config.ts sets a body limit above every app upload limit", () => {
    const config = readFileSync(
      join(process.cwd(), "apps/web/next.config.ts"),
      "utf8",
    );
    const match = config.match(/bodySizeLimit:\s*"(\d+(?:\.\d+)?)mb"/);
    expect(match, "bodySizeLimit must be configured").not.toBeNull();
    const limitMb = Number(match![1]);
    // Largest app-level upload limit: trade screenshots, 5 MB.
    expect(limitMb).toBeGreaterThan(5);
  });
});
