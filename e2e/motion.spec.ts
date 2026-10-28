import { expect, test, type Page } from "@playwright/test";

/**
 * Motion suite (Phase 16).
 *
 * Runs against the production build with NO Supabase env vars,
 * like the smoke and responsive suites — so only the public
 * pages (landing, login, register) render directly, and every
 * protected route redirects signed-out users to /login.
 *
 * What this suite proves:
 * - prefers-reduced-motion is respected: with reduced motion
 *   emulated, entrance animations are removed entirely and the
 *   content is fully visible immediately (opacity 1, no
 *   animation running). Without it, the login backdrop and
 *   card entrance animations are actually running.
 * - Motion causes no horizontal overflow at any mobile width.
 * - Touch targets stay reachable with animations on.
 *
 * What it cannot prove without a live Supabase project: the
 * signed-in motion (dashboard stagger, KPI count-up, drawer
 * slide, bottom-nav indicator, trade-saved banner). Those are
 * Phase 13/14 live-verification items — the same tokens and
 * components are verified here on the public pages, and the
 * count-up math is unit-tested in lib/motion/count-up.test.ts.
 * Nothing here fakes a login or a database.
 */

const WIDTHS = [320, 360, 390, 430, 768, 1280];

async function computedAnimation(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      opacity: cs.opacity,
    };
  }, selector);
}

test("reduced motion removes entrance animations and keeps content visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  const card = await computedAnimation(page, "main > div.motion-fade-in");
  expect(card, "login card wrapper exists").not.toBeNull();
  expect(card!.animationName, "no animation under reduced motion").toBe("none");
  expect(card!.opacity, "card fully visible under reduced motion").toBe("1");
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

  // Landing cards are visible immediately too.
  await page.goto("/");
  const landingCard = await computedAnimation(
    page,
    "section[aria-label='What is ready'] article",
  );
  expect(landingCard!.animationName, "no animation on landing under reduced motion").toBe(
    "none",
  );
  expect(landingCard!.opacity, "landing card fully visible").toBe("1");
});

test("login backdrop and card entrance animate when motion is allowed", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  const card = await computedAnimation(page, "main > div.motion-fade-in");
  expect(card!.animationName, "card entrance runs").toBe("motion-fade-in");
  const glow = await computedAnimation(page, "div.motion-login-glow");
  expect(glow, "login glow exists").not.toBeNull();
  expect(glow!.animationName, "login glow drifts").toBe("motion-login-drift");
  const grid = await computedAnimation(page, "div.motion-login-grid");
  expect(grid!.animationName, "login grid pans").toBe("motion-grid-pan");
});

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width}px with motion on`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/", "/login", "/register"]) {
      await page.goto(route);
      // Let entrance animations run to completion.
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      expect(
        overflow.scrollWidth,
        `overflow at ${width}px on ${route} (scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth})`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    }
  });

  test(`no horizontal overflow at ${width}px with reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    expect(overflow.scrollWidth, `overflow at ${width}px under reduced motion`).toBeLessThanOrEqual(
      overflow.clientWidth,
    );
  });
}

test("buttons stay geometrically stable on hover with motion on", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  // The login page's submit is disabled without Supabase, and a
  // disabled button is not hoverable — so this runs on the
  // landing page's enabled "Log in" button, which uses the same
  // Button component and variants.
  await page.goto("/");
  // Let the entrance animations finish first (400ms + up to
  // 360ms stagger), or the "before" box is measured mid-flight.
  await page.waitForTimeout(900);
  const button = page.getByRole("link", { name: "Log in" });
  const before = await button.boundingBox();
  expect(before, "button has a bounding box").not.toBeNull();
  await button.hover();
  await page.waitForTimeout(300);
  const after = await button.boundingBox();
  // Hover is a colour transition (and a 2% press scale only while
  // pressed), not a layout change: the button must not move or
  // resize while it animates.
  expect(after!.x, "button x stable on hover").toBeCloseTo(before!.x, 0);
  expect(after!.y, "button y stable on hover").toBeCloseTo(before!.y, 0);
  expect(after!.width, "button width stable on hover").toBeCloseTo(before!.width, 0);
  expect(after!.height, "button height stable on hover").toBeCloseTo(before!.height, 0);
});
