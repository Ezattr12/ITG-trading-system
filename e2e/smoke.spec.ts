import { expect, test } from "@playwright/test";

/**
 * Unauthenticated smoke suite (Phase 12).
 *
 * Runs against the production build with NO Supabase env vars —
 * the app must render its honest empty states and protect every
 * app route, not crash or pretend a session exists. Authenticated
 * workflows (signup, login, trades, goals, XP, certificates,
 * admin) need a live Supabase project and are Phase 13/14 tests.
 */

test("landing page renders with login and register links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ITG TraderOS" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  // getByLabel("Password") also matches the "Show password" toggle,
  // so target the input by id.
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
});

test("register page renders the sign-up form", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("protected routes redirect signed-out users to login", async ({ page }) => {
  for (const route of ["/dashboard", "/trades", "/trades/new", "/goals", "/admin", "/coach"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  }
});

test("login page is served with the security headers", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
});

test("unknown routes send signed-out users to login, not a crash", async ({ page }) => {
  // Signed-out, every non-public path — including one that does not
  // exist — redirects to /login. A signed-in 404 check is a
  // Phase 13/14 item, once a session can exist.
  const response = await page.goto("/no-such-route-ever");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login\?next=/);
});
