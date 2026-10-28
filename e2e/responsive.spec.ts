import { expect, test, type Page } from "@playwright/test";

/**
 * Responsive suite (Phase 15).
 *
 * Runs against the production build with NO Supabase env vars,
 * like the smoke suite — so the only pages that render directly
 * are the public ones (landing, login, register, forgot/reset
 * password, onboarding redirects). Every protected route
 * redirects signed-out users to /login, which is itself covered
 * here at every width.
 *
 * What this suite proves at each width:
 * - No horizontal overflow: document.documentElement.scrollWidth
 *   is never wider than the viewport. That is the concrete
 *   regression for the reported bug (desktop layout squeezed
 *   into a phone, huge empty space on the right).
 * - The viewport meta is device-width, so phones do not render
 *   a scaled-down desktop page.
 * - Touch targets on the login form are at least 44px tall.
 *
 * What it cannot prove without a live Supabase project: the
 * signed-in shell (sidebar, drawer, bottom tab bar) and the
 * authenticated pages (dashboard, trades, analytics and the
 * rest). Those are Phase 13/14 live-verification items — the
 * shell and pages are built from the same responsive tokens and
 * components, and the production build is verified to compile
 * and render them (see docs/phase-15.md). Nothing here fakes a
 * login or a database.
 */

const WIDTHS = [320, 360, 390, 430, 768, 1280];

async function assertNoHorizontalOverflow(page: Page, width: number) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `horizontal overflow at ${width}px (scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

test("viewport meta is device-width on every public page", async ({ page }) => {
  for (const route of ["/", "/login", "/register"]) {
    await page.goto(route);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport, `${route} viewport`).toContain("width=device-width");
  }
});

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width}px — public pages`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/", "/login", "/register", "/forgot-password", "/reset-password"]) {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();
      await assertNoHorizontalOverflow(page, width);
    }
  });

  test(`no horizontal overflow at ${width}px — protected routes redirect to login`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/dashboard",
      "/trades",
      "/trades/new",
      "/analytics",
      "/risk",
      "/plan",
      "/psychology",
      "/calendar",
      "/progress",
      "/goals",
      "/levels",
      "/achievements",
      "/certificates",
      "/reports",
      "/reviews/weekly",
      "/coach",
      "/notifications",
      "/profile",
      "/admin",
    ]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login\?next=/);
      await assertNoHorizontalOverflow(page, width);
    }
  });
}

test("login form controls are touch-friendly at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  const email = page.locator("#email");
  const password = page.locator("#password");
  const submit = page.getByRole("button", { name: "Log in" });
  for (const [name, locator] of [
    ["email input", email],
    ["password input", password],
    ["log in button", submit],
  ] as const) {
    const box = await locator.boundingBox();
    expect(box, `${name} has a bounding box`).not.toBeNull();
    expect(box!.height, `${name} is at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
});

test("landing page cards stack in a single column at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/");
  const cards = page.locator("section[aria-label='What is ready'] article");
  await expect(cards).toHaveCount(3);
  const boxes = await Promise.all(
    [0, 1, 2].map((i) => cards.nth(i).boundingBox()),
  );
  // Each card starts below the previous one — a single column.
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
});
