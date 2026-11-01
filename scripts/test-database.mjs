import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { buildReviewMigrationSql,verifyReviewSql } from "./lib/review-release.mjs";

const execAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const container = `hrp-db-test-${process.pid}-${Date.now().toString(36)}`;
const image = "postgres:17-alpine";
const psqlArgs = ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres"];
const sql = (input) => execFileSync("docker", psqlArgs, {
  input: "set client_min_messages=warning;\n" + input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
});
let started = false;
try {
  execFileSync("docker", ["run", "--detach", "--rm", "--network", "none", "--name", container,
    "--label", "hrp-test-suite=database", "--env", `POSTGRES_PASSWORD=${randomUUID()}`, image],
  { stdio: "pipe", timeout: 180_000 });
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      execFileSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { stdio: "pipe" });
      ready = true; break;
    } catch { await delay(500); }
  }
  if (!ready) throw new Error("Isolated PostgreSQL did not start");
  sql(readFileSync(new URL("tests/database/bootstrap.sql", root), "utf8"));
  const migrations = readdirSync(new URL("supabase/migrations/", root)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) {
    try { sql("begin;\n" + readFileSync(new URL("supabase/migrations/" + name, root), "utf8") + "\ncommit;"); }
    catch (error) { throw new Error("Migration failed: " + name, { cause: error }); }
  }
  for (const file of ["review-hardening.sql", "storage-audit.sql", "audit-outbox.sql"]) {
    const output = sql(readFileSync(new URL("tests/database/" + file, root), "utf8"));
    console.log(output.split("\n").filter((line) => line.includes("PASS")).join("\n"));
  }

  // Real concurrent transactions must not both create the same active identity.
  const first = execAsync("docker", psqlArgs.concat(["-c",
    "begin; insert into public.contracts (organization_id, contract_number) values ('11111111-1111-1111-1111-111111111111','CONCURRENT-UNIQUE'); select pg_sleep(1); commit;"]),
  { encoding: "utf8" });
  await delay(100);
  const second = execAsync("docker", psqlArgs.concat(["-c",
    "insert into public.contracts (organization_id, contract_number) values ('11111111-1111-1111-1111-111111111111','concurrent-unique');"]),
  { encoding: "utf8" });
  const results = await Promise.allSettled([first, second]);
  if (results.filter((result) => result.status === "fulfilled").length !== 1 ||
      !results.some((result) => result.status === "rejected" && String(result.reason.stderr).includes("contracts_active_identity_unique"))) {
    throw new Error("Concurrent duplicate protection failed");
  }
  console.log("PASS concurrent active contract uniqueness (including NULL dates)");
  const loginResults = await Promise.all(Array.from({ length: 10 }, () => execAsync("docker", psqlArgs.concat([
    "-At", "-c", "select (public.claim_login_attempt(repeat('b',64))->>'allowed')::boolean;",
  ]), { encoding: "utf8" })));
  if (loginResults.filter((result) => result.stdout.trim() === "t").length !== 5 ||
      loginResults.filter((result) => result.stdout.trim() === "f").length !== 5) {
    throw new Error("Concurrent login claims exceeded the five-attempt budget");
  }
  console.log("PASS concurrent login budget (exactly 5 of 10 requests allowed)");
  console.log(`PASS ${migrations.length} migrations applied on isolated PostgreSQL 17`);
  // Exercise the exact operational RPC bundle on a fresh pre-review database.
  sql("create database hrp_release_fixture; alter database hrp_release_fixture set search_path=public,extensions;");
  const releaseSql = input => execFileSync("docker", psqlArgs.concat(["-d","hrp_release_fixture"]), {
    input: "set client_min_messages=warning;\n" + input, encoding: "utf8", maxBuffer: 8*1024*1024, stdio: "pipe",
  });
  const bootstrap = readFileSync(new URL("tests/database/bootstrap.sql", root),"utf8")
    .replace(/^create role .*;\r?$/gm,"").replace("alter database postgres", "alter database hrp_release_fixture");
  releaseSql(bootstrap);
  for (const name of migrations.filter(name => name < "20261031000000")) {
    releaseSql("begin;\n" + readFileSync(new URL("supabase/migrations/" + name,root),"utf8") + "\ncommit;");
  }
  releaseSql(`insert into auth.users(id,email,raw_user_meta_data) values
   ('abababab-0000-4000-8000-000000000001','release-fixture@hrpartner.test','{"full_name":"Preserve release fixture"}');
   insert into public.partners(id,organization_id,name) values
   ('abababab-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111','Preserve partner');
   insert into public.contracts(id,organization_id,contract_number,partner_id,created_by) values
   ('abababab-0000-4000-8000-000000000003','11111111-1111-1111-1111-111111111111','PRESERVE-RELEASE',
    'abababab-0000-4000-8000-000000000002','abababab-0000-4000-8000-000000000001');
   insert into public.contract_files(id,organization_id,contract_id,bucket,object_key,original_filename,mime_type,file_size) values
   ('abababab-0000-4000-8000-000000000004','11111111-1111-1111-1111-111111111111','abababab-0000-4000-8000-000000000003',
    'isolated','contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000004/preserve.pdf',
    'preserve.pdf','application/pdf',123);`);
  const literal = value => "'" + value.replaceAll("'","''") + "'";
  const bundle = buildReviewMigrationSql();
  try {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(bundle + "\nselect 1/0;") + ");");
    throw new Error("Injected release failure unexpectedly committed");
  } catch (error) {
    if (!String(error.stderr).includes("division by zero")) throw error;
  }
  releaseSql("do $$ begin if to_regnamespace('hrp_private') is not null or to_regclass('public.audit_event_outbox') is not null then raise exception 'Release did not roll back atomically'; end if; end $$;");
  for (let attempt=0;attempt<2;attempt++) {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(bundle) + ");\n" + verifyReviewSql);
  }
  console.log("PASS exact release RPC bundle: atomic rollback, idempotent rerun, private receipts and unchanged data fingerprints");
} catch (error) {
  console.error(error.message);
  if (error.cause) console.error(error.cause.stderr?.toString() || error.cause.message);
  else if (error.stderr) console.error(error.stderr.toString());
  process.exitCode = 1;
} finally {
  if (started) execFileSync("docker", ["stop", "--time", "1", container], { stdio: "pipe" });
}
