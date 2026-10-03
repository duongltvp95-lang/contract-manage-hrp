import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * Playwright — W1-WEB-039..043, the plan's test matrix (section 100) driven
 * through a real browser.
 *
 * The suite defaults to port **3000** on purpose: the R2 bucket's CORS policy
 * names `http://localhost:3000` as an allowed origin, and the browser enforces
 * it on both the upload PUT and the PDF fetch. Running the suite on another port
 * would need that origin added to the bucket policy first.
 *
 * Locally `reuseExistingServer` means an already-running `pnpm dev` on 3000 is
 * reused; in CI nothing is listening and Playwright starts its own server with a
 * separate build directory, so it never collides with a real `next dev`.
 */

loadEnv({ path: ".env.local" });

const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Every spec shares one database and one admin account, and several of them
  // assert on counts; running them in parallel would make those flaky.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `node node_modules/next/dist/bin/next dev --port ${PORT}`,
        url: `${BASE_URL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          NODE_ENV: "development",
          NEXT_TELEMETRY_DISABLED: "1",
          NEXT_DIST_DIR: ".next-e2e",
        },
      },
});
