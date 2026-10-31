import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

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
  for (const file of ["review-hardening.sql", "storage-audit.sql"]) {
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
} catch (error) {
  console.error(error.message);
  if (error.cause) console.error(error.cause.stderr?.toString() || error.cause.message);
  else if (error.stderr) console.error(error.stderr.toString());
  process.exitCode = 1;
} finally {
  if (started) execFileSync("docker", ["stop", "--time", "1", container], { stdio: "pipe" });
}
