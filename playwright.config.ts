import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E (Phase 12, spec §43).
 *
 * What runs here today — the unauthenticated smoke suite against
 * the production build (`npm run build` then `npm start`):
 * landing page, login/register pages, signed-out redirects and
 * security headers. That is everything that can run honestly
 * without a live Supabase project.
 *
 * What does NOT run here yet: signup, login, add/edit/delete
 * trade, screenshot upload, goals, XP, certificates and admin
 * flows — they all need Supabase Auth + the applied migrations.
 * Those are Phase 13/14 tests, run against staging once the
 * migrations are applied (see docs/phase-12.md). Nothing here
 * fakes a login or a database.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build --workspace=@itg/web && npm run start --workspace=@itg/web",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
