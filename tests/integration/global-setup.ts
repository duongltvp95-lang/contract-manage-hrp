import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BASE_URL, TEST_PORT } from "./config";

/**
 * Boots one Next.js server for the integration suite.
 *
 * The suite has to exercise the real route handlers (`/api/files/*`), because
 * that is where authorization actually happens — and a route handler needs a
 * Next request context, so calling the services in-process is not an option.
 *
 * If a server is already listening on the test port it is reused, which makes
 * local iteration fast and avoids fighting over the port.
 */

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const PROBE_SOURCE = fileURLToPath(
  new URL("./fixtures/hardening-probe.route.ts", import.meta.url),
);
const PROBE_TARGET = `${repoRoot}app/api/hardening-probe/route.ts`;
const PROBE_DIR = dirname(PROBE_TARGET);

let child: ChildProcess | null = null;

async function serverIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/login`, {
      signal: AbortSignal.timeout(3_000),
      redirect: "manual",
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

/**
 * Builds the environment for the child server.
 *
 * Two inherited values have to be neutralised, and both were found the hard way
 * (the server answered 401 to a valid session while an identical manual server
 * answered 200):
 *
 *   1. `NODE_ENV=test`, which Vitest sets. A Next dev server running outside
 *      `development` rejects a session that the same cookie satisfies on a
 *      normal `pnpm dev` server. It is a dev server, so it is told so.
 *   2. Empty `NEXT_PUBLIC_*` entries. An entry that is present but empty
 *      shadows `.env.local`: Next only fills in variables it considers unset,
 *      so `hasEnvVars` would be false and every request would 401.
 */
function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const [key, value] of Object.entries(env)) {
    if (value === "") delete env[key];
  }

  return {
    ...env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    // Next 16 permits one `next dev` per project directory, keyed on the build
    // directory. Without this the suite cannot start while a developer's dev
    // server is running (`next.config.ts` reads NEXT_DIST_DIR).
    NEXT_DIST_DIR: ".next-test",
    PORT: String(TEST_PORT),
    // A 1 MB ceiling instead of the configured 50 MB. The over-limit test then
    // moves 2 MB rather than 51, and the value is configuration — the code path
    // under test is identical. Nothing else in this suite uploads.
    MAX_UPLOAD_SIZE_MB: "1",
    // Enables the fixture route below.
    HARDENING_PROBE: "1",
  };
}

/**
 * Installs the test-only probe route for the duration of the run.
 *
 * `completeUpload()` is the only place the real upload ceiling is enforced
 * against bytes that actually landed, and it is reachable from the browser only
 * as a server action invoked by a client that already measured the file — so the
 * case worth testing (declare small, upload large) cannot be produced through
 * the UI. This copies a route in to reach it.
 *
 * It is removed in teardown, it lives under `tests/`, and the route itself
 * answers 404 unless `HARDENING_PROBE=1`. It is never part of a production
 * build.
 */
function installProbeRoute(): void {
  mkdirSync(PROBE_DIR, { recursive: true });
  copyFileSync(PROBE_SOURCE, PROBE_TARGET);
  console.log("[integration] probe route installed at app/api/hardening-probe");
}

function removeProbeRoute(): void {
  rmSync(dirname(PROBE_TARGET), { recursive: true, force: true });
}

export default async function setup() {
  installProbeRoute();

  if (await serverIsUp()) {
    console.log(`[integration] reusing the server already listening on ${BASE_URL}`);
    return async () => {
      removeProbeRoute();
    };
  }

  const nextBin = `${repoRoot}node_modules/next/dist/bin/next`;
  const env = childEnvironment();

  const appKeys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  console.log(
    `[integration] app env handed to the server: ${appKeys
      .map((key) => `${key}=${env[key] ? "set" : "from .env.local"}`)
      .join(", ")}`,
  );

  child = spawn(process.execPath, [nextBin, "dev", "--port", String(TEST_PORT)], {
    cwd: repoRoot,
    env,
    stdio: "ignore",
  });

  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline) {
    if (await serverIsUp()) {
      console.log(`[integration] server ready on ${BASE_URL}`);
      return async () => {
        child?.kill();
        removeProbeRoute();
      };
    }

    if (child.exitCode !== null) {
      removeProbeRoute();
      throw new Error(
        `[integration] the Next server exited with code ${child.exitCode}`,
      );
    }

    await delay(1_000);
  }

  child.kill();
  removeProbeRoute();
  throw new Error(`[integration] the Next server never became ready on ${BASE_URL}`);
}
