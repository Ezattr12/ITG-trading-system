import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the 2026-10-29 production crash
 * (Digest 2190686083 on /profile): a Server Component passed an
 * inline `format` function to the client component
 * `AnimatedNumber`, which is not serializable across the
 * server→client boundary and throws during RSC rendering.
 *
 * Rule enforced here: files under `app/` are Server Components
 * (unless they declare "use client") and must never pass a
 * function prop to AnimatedNumber — they use the client-side
 * wrappers (CountUpMoney / CountUpPct / CountUpDecimal /
 * CountUpXp) whose format functions live inside count-up.tsx.
 */

const appDir = join(process.cwd(), "apps/web/app");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("RSC boundary: no function props from server pages to AnimatedNumber", () => {
  it("no app route file passes a format function to AnimatedNumber", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(appDir)) {
      const source = readFileSync(file, "utf8");
      if (source.includes('"use client"')) continue;
      if (/AnimatedNumber[^>]*format=/.test(source)) {
        offenders.push(file.replace(process.cwd(), ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app route files do not import AnimatedNumber directly", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(appDir)) {
      const source = readFileSync(file, "utf8");
      if (/import\s*\{[^}]*\bAnimatedNumber\b/.test(source)) {
        offenders.push(file.replace(process.cwd(), ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
