import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // Monorepo: transpile the shared calc package.
  transpilePackages: ["@itg/calc"],
  // pdfkit reads its font metrics (.afm) from its own package
  // directory at runtime; bundling it breaks that lookup
  // (ENOENT Helvetica.afm in the reports/certificate PDF
  // routes, found 2026-10-29). Keep it external so Node
  // resolves it from node_modules, data files included.
  serverExternalPackages: ["pdfkit"],
  experimental: {
    serverActions: {
      // Upload actions validate file size themselves (avatar
      // ≤ 2 MB, trade screenshots ≤ 5 MB) and return graceful
      // inline errors. The framework default of 1 MB sat BELOW
      // those app limits, so a valid 1–2 MB photo was rejected
      // with a thrown 413 ("Body exceeded 1 MB limit") before
      // the action ever ran — crashing /profile with a
      // server-side exception (Digest 3390255549, 2026-10-29).
      // 10 MB gives every app upload limit headroom plus
      // multipart overhead; the app limits remain the rule.
      bodySizeLimit: "10mb",
    },
  },
  // PWA-ready headers are added in Phase 4; no service worker yet.
  // Security headers (Phase 11, spec §5) — see lib/security/headers.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
};

export default nextConfig;
