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
