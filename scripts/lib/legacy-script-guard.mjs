import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parse } from "dotenv";

/**
 * @typedef {import("@supabase/supabase-js").SupabaseClient} SupabaseClient
 * @typedef {Record<string, string | undefined>} EnvRecord
 * @typedef {{
 *   mode: "plan";
 *   legacy: true;
 *   readOnly?: boolean;
 *   script: string;
 *   statementCount?: number;
 *   supersededBy?: string;
 *   expectedProjectHost: string;
 *   recommendedRunner?: string;
 *   note: string;
 * }} LegacyScriptPlan
 * @typedef {{
 *   execute: true;
 *   env: EnvRecord;
 *   hostname: string;
 *   supabaseUrl: string;
 *   supabaseServiceRoleKey: string;
 *   service: SupabaseClient;
 * }} LegacyScriptExecutionReady
 * @typedef {{ execute: false; plan: LegacyScriptPlan } | LegacyScriptExecutionReady} LegacyScriptOutcome
 */

export const EXPECTED_HRP_SUPABASE_HOSTNAME = "vohrerrbthbrkwjllnlj.supabase.co";

/**
 * @param {string[]} argv
 * @param {string} flagName
 * @returns {string | null}
 */
function readFlagValue(argv, flagName) {
  const index = argv.indexOf(flagName);
  if (index < 0) return null;
  const candidate = argv[index + 1];
  if (!candidate || candidate.startsWith("--")) {
    throw new Error(`Missing value after ${flagName}`);
  }
  return candidate;
}

/**
 * @param {string} rawUrl
 * @param {{ allowLocalhost?: boolean }} [options]
 * @returns {string}
 */
function validateTargetHostname(rawUrl, { allowLocalhost = false } = {}) {
  if (!rawUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing in the supplied environment");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }

  if (parsed.hostname === EXPECTED_HRP_SUPABASE_HOSTNAME) {
    return parsed.hostname;
  }

  if (
    allowLocalhost &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
  ) {
    return parsed.hostname;
  }

  throw new Error(
    `Refusing to target unverified Supabase host "${parsed.hostname}" (expected "${EXPECTED_HRP_SUPABASE_HOSTNAME}")`,
  );
}

/**
 * @param {{ argv: string[]; envOverride: EnvRecord | null; allowLocalhost?: boolean }} params
 */
function loadValidatedCredentials({ argv, envOverride, allowLocalhost = false }) {
  /** @type {EnvRecord | null} */
  let envRecord = envOverride;
  if (!envRecord) {
    const envPath = readFlagValue(argv, "--env");
    if (!envPath) {
      throw new Error(
        "Pass --env <private HRP environment file>; implicit .env.local loading is disabled for safety",
      );
    }
    envRecord = parse(readFileSync(envPath, "utf8"));
  }

  const supabaseUrl = envRecord.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseServiceRoleKey = envRecord.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  const hostname = validateTargetHostname(supabaseUrl, { allowLocalhost });
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing in the supplied environment");
  }

  return {
    env: envRecord,
    hostname,
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}

/**
 * @param {{
 *   scriptName: string;
 *   statementCount?: number;
 *   supersededBy?: string;
 *   mode?: "ddl" | "verify";
 *   allowLocalhost?: boolean;
 *   argv?: string[];
 *   envOverride?: EnvRecord | null;
 * }} options
 * @returns {LegacyScriptOutcome}
 */
export function resolveLegacyScriptExecution({
  scriptName,
  statementCount = 0,
  supersededBy = "supabase/migrations/",
  mode = "ddl",
  allowLocalhost = false,
  argv = process.argv,
  envOverride = null,
}) {
  if (!scriptName) {
    throw new Error("scriptName is required");
  }

  const hasEnvFlag = argv.includes("--env") || envOverride !== null;

  if (mode === "verify") {
    const shouldCheck = argv.includes("--check") || argv.includes("--apply");
    if (!shouldCheck) {
      if (hasEnvFlag) {
        loadValidatedCredentials({ argv, envOverride, allowLocalhost });
      }
      return {
        execute: false,
        plan: {
          mode: "plan",
          legacy: true,
          readOnly: true,
          script: scriptName,
          expectedProjectHost: EXPECTED_HRP_SUPABASE_HOSTNAME,
          note: "Dry-run only. Pass --env <file> --check to run read-only verification.",
        },
      };
    }

    const credentials = loadValidatedCredentials({ argv, envOverride, allowLocalhost });
    const service = createClient(
      credentials.supabaseUrl,
      credentials.supabaseServiceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    return {
      execute: true,
      ...credentials,
      service,
    };
  }

  const wantsApply = argv.includes("--apply");
  if (!wantsApply) {
    if (hasEnvFlag) {
      loadValidatedCredentials({ argv, envOverride, allowLocalhost: false });
    }
    return {
      execute: false,
      plan: {
        mode: "plan",
        legacy: true,
        script: scriptName,
        statementCount,
        supersededBy,
        expectedProjectHost: EXPECTED_HRP_SUPABASE_HOSTNAME,
        recommendedRunner: "scripts/deploy-*-migrations.mjs",
        note: "Dry-run only. Historical DDL is already captured in supabase/migrations/. Use transactional scripts/deploy-*-migrations.mjs for schema releases.",
      },
    };
  }

  if (!argv.includes("--allow-legacy-sql")) {
    throw new Error(
      `Refusing to execute legacy DDL script "${scriptName}" without --allow-legacy-sql. Historical SQL is superseded by ${supersededBy} and transactional scripts/deploy-*-migrations.mjs.`,
    );
  }

  const credentials = loadValidatedCredentials({
    argv,
    envOverride,
    allowLocalhost: false,
  });
  const service = createClient(
    credentials.supabaseUrl,
    credentials.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  return {
    execute: true,
    ...credentials,
    service,
  };
}

/**
 * @param {{
 *   scriptName: string;
 *   statementCount?: number;
 *   supersededBy?: string;
 * }} options
 * @returns {LegacyScriptExecutionReady}
 */
export function guardLegacyDdlScript({
  scriptName,
  statementCount = 0,
  supersededBy = "supabase/migrations/",
}) {
  const outcome = resolveLegacyScriptExecution({
    scriptName,
    statementCount,
    supersededBy,
    mode: "ddl",
  });
  if (!outcome.execute) {
    console.log(JSON.stringify(outcome.plan));
    process.exit(0);
  }
  return outcome;
}

/**
 * @param {{
 *   scriptName: string;
 *   allowLocalhost?: boolean;
 * }} options
 * @returns {LegacyScriptExecutionReady}
 */
export function guardLegacyVerifyScript({
  scriptName,
  allowLocalhost = false,
}) {
  const outcome = resolveLegacyScriptExecution({
    scriptName,
    mode: "verify",
    allowLocalhost,
  });
  if (!outcome.execute) {
    console.log(JSON.stringify(outcome.plan));
    process.exit(0);
  }
  return outcome;
}
