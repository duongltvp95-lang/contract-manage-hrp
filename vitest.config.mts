import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

/**
 * Vitest — W1-WEB-039/040.
 *
 * Two projects, one config:
 *   unit        — pure logic only. No network, no secrets. This is what CI runs
 *                 on every push.
 *   integration — talks to the real Supabase project and to a real Next server.
 *                 Skipped (with a clear message) when `.env.local` is absent, so
 *                 a fork without credentials still gets a green unit run.
 *
 * The aliases mirror `tsconfig.json` so a test imports exactly what the app
 * imports (`@/lib/...`, `@schemas/...`).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "@schemas": `${root}packages/schemas`,
      // See tests/setup/server-only-stub.ts for why this is aliased.
      "server-only": `${root}tests/setup/server-only-stub.ts`,
    },
  },
  test: {
    environment: "node",
    reporters: process.env.CI ? ["github", "default"] : ["default"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // The suite shares one database and one server; parallel files would
          // fight over the same fixtures.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
