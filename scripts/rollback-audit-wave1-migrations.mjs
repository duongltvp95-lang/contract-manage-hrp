import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import {
  auditWave1MigrationManifest,
  buildAuditWave1RollbackSql,
  verifyAuditWave1RollbackSql,
} from "./lib/audit-wave1-release.mjs";

const flag = process.argv.indexOf("--env");
if (!process.argv.includes("--apply") && (flag < 0 || !process.argv[flag + 1])) {
  console.log(
    JSON.stringify({
      mode: "plan",
      action: "rollback-wave1",
      project: "vohrerrbthbrkwjllnlj",
      migrationsToRevert: auditWave1MigrationManifest()
        .map(({ version }) => version)
        .reverse(),
      transactional: true,
      businessData: "fingerprint-verified unchanged",
      usage: "node scripts/rollback-audit-wave1-migrations.mjs --env <env-file> [--apply] [--evidence <json>]",
    }),
  );
  process.exit(0);
}

if (flag < 0 || !process.argv[flag + 1]) {
  throw new Error(
    "Pass --env <private HRP environment file>; add --apply only for an authorized rollback",
  );
}

const env = parse(readFileSync(process.argv[flag + 1]));
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "vohrerrbthbrkwjllnlj.supabase.co") {
  throw new Error("This rollback script is restricted to the verified HRP project");
}

/**
 * @param {string} sql
 */
async function rpc(sql) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(55_000),
  });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    data: body ? JSON.parse(body) : null,
  };
}

if (!process.argv.includes("--apply")) {
  console.log(
    JSON.stringify({
      mode: "plan",
      action: "rollback-wave1",
      project: "vohrerrbthbrkwjllnlj",
      migrationsToRevert: auditWave1MigrationManifest()
        .map(({ version }) => version)
        .reverse(),
      transactional: true,
      businessData: "fingerprint-verified unchanged",
    }),
  );
} else {
  const rolledBack = await rpc(buildAuditWave1RollbackSql());
  if (!rolledBack.ok) {
    throw new Error(
      `Rollback transaction failed and must be inspected before retry: ${JSON.stringify(rolledBack.data)}`,
    );
  }

  const verified = await rpc(verifyAuditWave1RollbackSql);
  if (!verified.ok) {
    throw new Error(`Post-rollback verification failed: ${JSON.stringify(verified.data)}`);
  }

  const receipt = await rpc(
    `do $receipt$ declare v jsonb; begin select to_jsonb(r) into v from hrp_private.review_rollbacks r where id='audit-wave1-20261106'; raise exception 'HRP_ROLLBACK:%',v; end $receipt$;`,
  );
  if (!receipt.data?.message?.startsWith("HRP_ROLLBACK:")) {
    throw new Error("Cannot read committed rollback receipt");
  }
  const evidence = JSON.parse(receipt.data.message.slice("HRP_ROLLBACK:".length));
  const outputFlag = process.argv.indexOf("--evidence");
  if (outputFlag >= 0 && process.argv[outputFlag + 1]) {
    writeFileSync(process.argv[outputFlag + 1], JSON.stringify(evidence, null, 2));
  }
  console.log(
    JSON.stringify({
      status: "rolled_back_and_verified",
      project: "vohrerrbthbrkwjllnlj",
      rolledBackAt: evidence.rolled_back_at,
      businessDataUnchanged:
        JSON.stringify(evidence.fingerprints_before) ===
        JSON.stringify(evidence.fingerprints_after),
    }),
  );
}
