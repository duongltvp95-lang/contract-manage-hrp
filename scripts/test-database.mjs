import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { buildReviewMigrationSql,verifyReviewSql } from "./lib/review-release.mjs";
import {
  buildAuditWave1MigrationSql,
  buildAuditWave1RollbackSql,
  verifyAuditWave1RollbackSql,
  verifyAuditWave1Sql,
} from "./lib/audit-wave1-release.mjs";
import {
  buildAuditWave2MigrationSql,
  buildAuditWave2RollbackSql,
  verifyAuditWave2RollbackSql,
  verifyAuditWave2Sql,
} from "./lib/audit-wave2-release.mjs";

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
      const logs = execFileSync("docker", ["logs", container], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      if (!logs.includes("PostgreSQL init process complete; ready for start up.")) {
        await delay(300);
        continue;
      }
      execFileSync("docker", ["exec", container, "psql", "-X", "-U", "postgres", "-c", "select 1"], { stdio: "pipe" });
      ready = true; break;
    } catch { await delay(300); }
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

  // Regression (A02/A10): Two concurrent transactions deleting two different company
  // links of the same partner must serialize per partner_id and NEVER leave 0 links
  // (tested under both READ COMMITTED and REPEATABLE READ).
  sql(`insert into public.partners(id, organization_id, name) values
    ('dddddddd-0000-4000-8000-000000000999','11111111-1111-1111-1111-111111111111','Concurrent junction partner')
    on conflict (id) do nothing;
    insert into public.partner_companies(partner_id, company_id) values
    ('dddddddd-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000001'),
    ('dddddddd-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000002')
    on conflict do nothing;`);

  for (const isolation of ["read committed", "repeatable read"]) {
    sql(`insert into public.partner_companies(partner_id, company_id) values
      ('dddddddd-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000001'),
      ('dddddddd-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000002')
      on conflict do nothing;`);

    const txA = execAsync("docker", psqlArgs.concat(["-c",
      `begin isolation level ${isolation};
       select count(*) from public.partner_companies where partner_id='dddddddd-0000-4000-8000-000000000999';
       delete from public.partner_companies
        where partner_id='dddddddd-0000-4000-8000-000000000999'
          and company_id='00000000-0000-4000-8000-000000000001';
       select pg_sleep(0.8);
       commit;`]),
    { encoding: "utf8" });
    await delay(100);
    const txB = execAsync("docker", psqlArgs.concat(["-c",
      `begin isolation level ${isolation};
       select count(*) from public.partner_companies where partner_id='dddddddd-0000-4000-8000-000000000999';
       delete from public.partner_companies
        where partner_id='dddddddd-0000-4000-8000-000000000999'
          and company_id='00000000-0000-4000-8000-000000000002';
       commit;`]),
    { encoding: "utf8" });

    const pcResults = await Promise.allSettled([txA, txB]);
    const committedCount = pcResults.filter((r) => r.status === "fulfilled").length;
    const remainingLinks = Number(
      execFileSync("docker", psqlArgs.concat([
        "-At", "-c",
        "select count(*) from public.partner_companies where partner_id='dddddddd-0000-4000-8000-000000000999';",
      ]), { encoding: "utf8" }).trim(),
    );
    if (committedCount !== 1 || remainingLinks !== 1) {
      throw new Error(
        `Concurrent partner_companies deletion (${isolation}) failed: committed=${committedCount}, remainingLinks=${remainingLinks}`,
      );
    }
  }
  console.log("PASS concurrent partner_companies last-link serialization (READ COMMITTED & REPEATABLE READ)");
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

  // Rehearse Wave 1 zero-downtime version transition, app-only rollback, full DB rollback, and clean re-apply.
  releaseSql(`set request.jwt.claim.role='service_role';
    do $$
    begin
      if not public.register_contract_upload_intent(
        'contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000010/pre-wave1.pdf',
        'abababab-0000-4000-8000-000000000010','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003','abababab-0000-4000-8000-000000000001'
      ) then
        raise exception 'pre-Wave-1 canonical upload intent failed';
      end if;
      perform public.complete_contract_file_upload(
        'abababab-0000-4000-8000-000000000010','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003',
        'contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000010/pre-wave1.pdf',
        'isolated','pre-wave1.pdf','application/pdf',256,'etag-pre-wave1','abababab-0000-4000-8000-000000000001','document'
      );
    end $$;`);

  const wave1Bundle = buildAuditWave1MigrationSql();
  const wave1Rollback = buildAuditWave1RollbackSql();
  try {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave1Bundle + "\nselect 1/0;") + ");");
    throw new Error("Injected Wave 1 release failure unexpectedly committed");
  } catch (error) {
    if (!String(error.stderr).includes("division by zero")) throw error;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave1Bundle) + ");\n" + verifyAuditWave1Sql);
  }

  // Transition & app-only rollback check: old app (contracts/) AND new app (uploads-staging/) both work!
  releaseSql(`set request.jwt.claim.role='service_role';
    do $$
    begin
      if not public.register_contract_upload_intent(
        'contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000011/old-app-during-transition.pdf',
        'abababab-0000-4000-8000-000000000011','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003','abababab-0000-4000-8000-000000000001'
      ) then
        raise exception 'old app canonical upload intent failed after Wave 1 migration';
      end if;
      perform public.complete_contract_file_upload(
        'abababab-0000-4000-8000-000000000011','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003',
        'contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000011/old-app-during-transition.pdf',
        'isolated','old-app-during-transition.pdf','application/pdf',512,'etag-old-app','abababab-0000-4000-8000-000000000001','document'
      );
      if not public.register_contract_upload_intent(
        'uploads-staging/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000012/new-app-staged.pdf',
        'abababab-0000-4000-8000-000000000012','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003','abababab-0000-4000-8000-000000000001'
      ) then
        raise exception 'new app staged upload intent failed';
      end if;
      perform public.complete_contract_file_upload(
        'abababab-0000-4000-8000-000000000012','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003',
        'contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000012/new-app-staged.pdf',
        'isolated','new-app-staged.pdf','application/pdf',768,'etag-new-app','abababab-0000-4000-8000-000000000001','document'
      );
      if (select count(*) from public.pending_contract_uploads) <> 0 then
        raise exception 'upload intents did not clear cleanly';
      end if;
    end $$;`);

  // Transition & app-only rollback check for A01 archiving:
  // Verify that a non-privileged authenticated caller (`can_manage_archived = false`)
  // executing the exact pre-cutover `UPDATE ... SET archived_at = now() ... RETURNING *`
  // succeeds during the version transition window, yet cannot read the archived row afterward!
  releaseSql(`set request.jwt.claim.role='service_role';
    insert into public.contracts(id,organization_id,contract_number,partner_id,created_by) values
    ('abababab-0000-4000-8000-000000000020','11111111-1111-1111-1111-111111111111','LEGACY-TRANSITION-ARCHIVE',
     'abababab-0000-4000-8000-000000000002','abababab-0000-4000-8000-000000000001');
    begin;
    set local role authenticated;
    set local request.jwt.claim.role='authenticated';
    set local request.jwt.claim.sub='abababab-0000-4000-8000-000000000001';
    do $$
    declare
      v_row public.contracts%rowtype;
    begin
      update public.contracts
         set archived_at = now()
       where id = 'abababab-0000-4000-8000-000000000020'
         and organization_id = '11111111-1111-1111-1111-111111111111'
         and archived_at is null
      returning * into v_row;

      if v_row.id is distinct from 'abababab-0000-4000-8000-000000000020'::uuid
         or v_row.archived_at is null then
        raise exception 'old app UPDATE ... RETURNING archive failed after Wave 1 migration';
      end if;
    end $$;
    commit;
    begin;
    set local role authenticated;
    set local request.jwt.claim.role='authenticated';
    set local request.jwt.claim.sub='abababab-0000-4000-8000-000000000001';
    do $$
    begin
      if (select count(*) from public.contracts where id = 'abababab-0000-4000-8000-000000000020') <> 0 then
        raise exception 'archived contract remained readable to non-privileged user after commit';
      end if;
    end $$;
    commit;
    do $$
    begin
      if (select count(*) from hrp_private.archive_returning_grants) <> 0 then
        raise exception 'hrp_private.archive_returning_grants did not clean up on commit';
      end if;
    end $$;`);

  // Full DB rollback check + idempotent rerun + post-rollback upload + clean Wave 1 re-apply
  for (let attempt = 0; attempt < 2; attempt++) {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave1Rollback) + ");\n" + verifyAuditWave1RollbackSql);
  }
  releaseSql(`set request.jwt.claim.role='service_role';
    do $$
    begin
      if (select count(*) from public.contract_files where contract_id='abababab-0000-4000-8000-000000000003') <> 4 then
        raise exception 'Wave 1 DB rollback did not preserve committed contract_files';
      end if;
      if not public.register_contract_upload_intent(
        'contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000013/post-rollback.pdf',
        'abababab-0000-4000-8000-000000000013','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003','abababab-0000-4000-8000-000000000001'
      ) then
        raise exception 'canonical upload intent failed after full Wave 1 DB rollback';
      end if;
      perform public.complete_contract_file_upload(
        'abababab-0000-4000-8000-000000000013','11111111-1111-1111-1111-111111111111',
        'abababab-0000-4000-8000-000000000003',
        'contracts/11111111-1111-1111-1111-111111111111/abababab-0000-4000-8000-000000000003/abababab-0000-4000-8000-000000000013/post-rollback.pdf',
        'isolated','post-rollback.pdf','application/pdf',512,'etag-post-rb','abababab-0000-4000-8000-000000000001','document'
      );
    end $$;`);
  releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave1Bundle) + ");\n" + verifyAuditWave1Sql);
  console.log("PASS Wave 1 zero-downtime upload transition, app-only rollback, full DB rollback, and clean re-apply");

  // Rehearse Wave 2 stacked release, dependency guard on Wave 1 rollback, ordered Wave 2 -> Wave 1 rollback, and clean re-apply.
  const wave2Bundle = buildAuditWave2MigrationSql();
  const wave2Rollback = buildAuditWave2RollbackSql();
  for (let attempt = 0; attempt < 2; attempt++) {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave2Bundle) + ");\n" + verifyAuditWave2Sql);
  }
  try {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave1Rollback) + ");");
    throw new Error("Wave 1 rollback unexpectedly succeeded while Wave 2 remained applied");
  } catch (error) {
    if (!String(error.stderr).includes("Rollback Wave 2")) throw error;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave2Rollback) + ");\n" + verifyAuditWave2RollbackSql);
  }
  releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave1Rollback) + ");\n" + verifyAuditWave1RollbackSql);
  releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave1Bundle) + ");\n" + verifyAuditWave1Sql);
  releaseSql("set request.jwt.claim.role='service_role'; select public.exec_sql(" + literal(wave2Bundle) + ");\n" + verifyAuditWave2Sql);
  console.log("PASS Wave 2 stacked release, ordered Wave 2 -> Wave 1 DB rollback, and clean re-apply");
} catch (error) {
  console.error(error.message);
  if (error.cause) console.error(error.cause.stderr?.toString() || error.cause.message);
  else if (error.stderr) console.error(error.stderr.toString());
  process.exitCode = 1;
} finally {
  if (started) execFileSync("docker", ["stop", "--time", "1", container], { stdio: "pipe" });
}
