import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // Monorepo: transpile the shared calc package.
  transpilePackages: ["@itg/calc"],
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
