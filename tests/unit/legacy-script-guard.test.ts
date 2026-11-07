import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_HRP_SUPABASE_HOSTNAME,
  resolveLegacyScriptExecution,
} from "../../scripts/lib/legacy-script-guard.mjs";

describe("legacy operational script guard (A14)", () => {
  it("defaults DDL scripts to dry-run plan mode with zero implicit .env.local reads", () => {
    const outcome = resolveLegacyScriptExecution({
      scriptName: "scripts/apply-round38-performance-indexes.mjs",
      statementCount: 6,
      supersededBy: "supabase/migrations/20261021000000_performance_indexes.sql",
      mode: "ddl",
      argv: ["node", "scripts/apply-round38-performance-indexes.mjs"],
    });

    expect(outcome.execute).toBe(false);
    if (!outcome.execute) {
      expect(outcome.plan).toMatchObject({
        mode: "plan",
        legacy: true,
        script: "scripts/apply-round38-performance-indexes.mjs",
        statementCount: 6,
        expectedProjectHost: EXPECTED_HRP_SUPABASE_HOSTNAME,
        recommendedRunner: "scripts/deploy-*-migrations.mjs",
      });
    }
  });

  it("blocks --apply unless --allow-legacy-sql is also supplied", () => {
    expect(() =>
      resolveLegacyScriptExecution({
        scriptName: "scripts/apply-round8-audit-enum.mjs",
        statementCount: 4,
        supersededBy: "supabase/migrations/20261031094000_mfa_audit_action.sql",
        mode: "ddl",
        argv: ["node", "scripts/apply-round8-audit-enum.mjs", "--apply"],
        envOverride: {
          NEXT_PUBLIC_SUPABASE_URL: `https://${EXPECTED_HRP_SUPABASE_HOSTNAME}`,
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
        },
      }),
    ).toThrow(/--allow-legacy-sql/);
  });

  it("requires explicit --env when executing with --apply --allow-legacy-sql", () => {
    expect(() =>
      resolveLegacyScriptExecution({
        scriptName: "scripts/apply-round8-audit-enum.mjs",
        mode: "ddl",
        argv: [
          "node",
          "scripts/apply-round8-audit-enum.mjs",
          "--apply",
          "--allow-legacy-sql",
        ],
      }),
    ).toThrow(/Pass --env/);
  });

  it("rejects unverified Supabase project hostnames", () => {
    expect(() =>
      resolveLegacyScriptExecution({
        scriptName: "scripts/apply-round8-audit-enum.mjs",
        mode: "ddl",
        argv: [
          "node",
          "scripts/apply-round8-audit-enum.mjs",
          "--apply",
          "--allow-legacy-sql",
        ],
        envOverride: {
          NEXT_PUBLIC_SUPABASE_URL: "https://wrongproject.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
        },
      }),
    ).toThrow(/Refusing to target unverified Supabase host/);
  });

  it("creates a non-persistent service client only when --apply --allow-legacy-sql and verified host match", () => {
    const outcome = resolveLegacyScriptExecution({
      scriptName: "scripts/apply-round38-performance-indexes.mjs",
      mode: "ddl",
      argv: [
        "node",
        "scripts/apply-round38-performance-indexes.mjs",
        "--apply",
        "--allow-legacy-sql",
      ],
      envOverride: {
        NEXT_PUBLIC_SUPABASE_URL: `https://${EXPECTED_HRP_SUPABASE_HOSTNAME}`,
        SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig",
      },
    });

    expect(outcome.execute).toBe(true);
    if (outcome.execute) {
      expect(outcome.hostname).toBe(EXPECTED_HRP_SUPABASE_HOSTNAME);
      expect(outcome.service).toBeDefined();
    }
  });

  it("supports localhost override only for read-only verify scripts that explicitly opt in", () => {
    expect(() =>
      resolveLegacyScriptExecution({
        scriptName: "scripts/post-verify-round35.mjs",
        mode: "verify",
        allowLocalhost: false,
        argv: ["node", "scripts/post-verify-round35.mjs", "--check"],
        envOverride: {
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig",
        },
      }),
    ).toThrow(/Refusing to target unverified Supabase host/);

    const localVerify = resolveLegacyScriptExecution({
      scriptName: "scripts/check-partner-count.ts",
      mode: "verify",
      allowLocalhost: true,
      argv: ["node", "scripts/check-partner-count.ts", "--check"],
      envOverride: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig",
      },
    });
    expect(localVerify.execute).toBe(true);
  });

  it("enforces guardLegacyDdlScript / guardLegacyVerifyScript across every legacy script in scripts/", () => {
    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const entries = readdirSync(scriptsDir);
    const applyScripts = entries.filter(
      (name) => name.startsWith("apply-") && name.endsWith(".mjs"),
    );

    expect(applyScripts.length).toBeGreaterThanOrEqual(17);

    for (const fileName of applyScripts) {
      const source = readFileSync(path.join(scriptsDir, fileName), "utf8");
      expect(
        source,
        `${fileName} must call guardLegacyDdlScript`,
      ).toContain("guardLegacyDdlScript(");
      expect(
        source,
        `${fileName} must not implicitly load .env.local`,
      ).not.toMatch(/dotenv\.config\s*\(/);
    }

    for (const verifyScript of ["post-verify-round35.mjs", "check-partner-count.ts"]) {
      const source = readFileSync(path.join(scriptsDir, verifyScript), "utf8");
      expect(
        source,
        `${verifyScript} must call guardLegacyVerifyScript`,
      ).toContain("guardLegacyVerifyScript(");
      expect(
        source,
        `${verifyScript} must not implicitly load .env.local`,
      ).not.toMatch(/dotenv\.config\s*\(/);
    }
  });
});
