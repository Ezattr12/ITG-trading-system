import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror apps/web/tsconfig.json `paths`: the app imports
    // `@/lib/...`; without this alias Vitest could not even load
    // modules that use it at runtime (Phase 12 fix — analytics
    // and discipline query modules were untestable before this).
    alias: {
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/web/lib/**/*.test.ts",
      "apps/mcp-server/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
