import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { S3Client, HeadBucketCommand, CreateBucketCommand, GetObjectCommand, PutObjectCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { testTotp } from '../tests/setup/totp.ts';

const argument = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const statusFile = argument('--status-json');
const container = argument('--database-container');
const storageFile = argument('--storage-env');
const localStorage = process.argv.includes('--local-storage');
const bucket = argument('--bucket') ?? 'hrp-review-test-20261101';
if (!statusFile || (!storageFile && !localStorage) || !container?.startsWith('supabase_db_hrp-isolated-') || !/^hrp-review-test-[a-z0-9-]+$/.test(bucket)) {
  throw new Error('Pass --status-json, --database-container supabase_db_hrp-isolated-*, --storage-env and --bucket hrp-review-test-*');
}
const status = JSON.parse(readFileSync(statusFile, 'utf8'));
if (!['127.0.0.1', 'localhost'].includes(new URL(status.API_URL).hostname)) throw new Error('Test setup refuses non-loopback Supabase');
const inspect = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
if (!inspect.Name.endsWith(container) || !inspect.Config.Image.includes('supabase/postgres')) throw new Error('Unexpected database container');
const sql = (input) => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
  { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
sql(`create table if not exists public.hrp_test_migrations(version text primary key, checksum text not null);
 alter table public.hrp_test_migrations enable row level security;
 revoke all on public.hrp_test_migrations from public,anon,authenticated;`);
const applied = new Map(sql('copy (select version,checksum from public.hrp_test_migrations) to stdout with csv;')
  .trim().split('\n').filter(Boolean).map(line => line.trim().split(',')));
for (const filename of readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
  const source = readFileSync(new URL('../supabase/migrations/' + filename, import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(source).digest('hex');
  if (applied.has(filename)) {
    if (applied.get(filename) !== checksum) throw new Error('Applied test migration changed: ' + filename);
    continue;
  }
  sql('begin;\n' + source + `\ninsert into public.hrp_test_migrations values ('${filename}','${checksum}');\ncommit;`);
}
if (!sql("select to_regclass('public.hrp_test_environment') is not null;").includes(' t')) {
  sql(readFileSync(new URL('../tests/setup/test-environment.sql', import.meta.url), 'utf8'));
}
sql("notify pgrst,'reload schema';");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const email = 'hrp.review.admin@hrpartner.test';
const password = randomUUID() + '!Test9aA';
const listed = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listed.error) throw new Error('Cannot inspect isolated Auth fixture');
const existing = listed.data.users.find(user => user.email === email);
if (existing) {
  if (!process.argv.includes('--reset-fixture')) throw new Error('Test admin already exists; use .env.test.local or pass --reset-fixture on this isolated stack');
  const deleted = await admin.auth.admin.deleteUser(existing.id);
  if (deleted.error) throw new Error('Cannot reset the disposable isolated administrator');
}
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'HRP test administrator' } });
if (created.error || !created.data.user) throw new Error('Cannot create isolated test administrator', { cause: created.error });
const profile = await admin.from('profiles').update({ role: 'admin', is_active: true }).eq('id', created.data.user.id);
if (profile.error) throw new Error('Cannot prepare isolated administrator profile', { cause: profile.error });
const user = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const signedIn = await user.auth.signInWithPassword({ email, password });
if (signedIn.error) throw new Error('Cannot sign in isolated administrator');
const factor = await user.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Isolated HRP tests' });
if (factor.error) throw new Error('Enable TOTP enrollment in the isolated Supabase config', { cause: factor.error });
const verification = await user.auth.mfa.challengeAndVerify({ factorId: factor.data.id, code: testTotp(factor.data.totp.secret) });
if (verification.error) throw new Error('Cannot verify isolated TOTP fixture');
const storage = localStorage ? {
  R2_ENDPOINT: status.STORAGE_S3_URL || status.S3_PROTOCOL_URL || status.API_URL + '/storage/v1/s3',
  R2_ACCESS_KEY_ID: status.S3_PROTOCOL_ACCESS_KEY_ID || status.S3_ACCESS_KEY,
  R2_SECRET_ACCESS_KEY: status.S3_PROTOCOL_ACCESS_KEY_SECRET || status.S3_SECRET_KEY,
  R2_ACCOUNT_ID: 'isolated',
} : parse(readFileSync(storageFile));
if (!storage.R2_ACCESS_KEY_ID || !storage.R2_SECRET_ACCESS_KEY) throw new Error('S3-compatible test credentials are missing');
const s3 = new S3Client({ region: 'auto', endpoint: storage.R2_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: storage.R2_ACCESS_KEY_ID, secretAccessKey: storage.R2_SECRET_ACCESS_KEY } });
let createdBucket = false;
try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }
catch (error) {
  if (error.$metadata?.httpStatusCode !== 404) throw new Error('Test bucket unavailable (status ' + error.$metadata?.httpStatusCode + ')');
  await s3.send(new CreateBucketCommand({ Bucket: bucket })); createdBucket = true;
}
const markerKey = '__hrp_test_environment.json';
if (!createdBucket) {
  const marker = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: markerKey }));
  if (JSON.parse(await marker.Body.transformToString()).purpose !== 'hrp-isolated-tests') throw new Error('Refusing an unmarked bucket');
} else {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: markerKey,
    Body: JSON.stringify({ purpose: 'hrp-isolated-tests', createdAt: new Date().toISOString() }), ContentType: 'application/json' }));
}
const origins = [3108, 3308].flatMap(port => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
if (!localStorage) await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [{
  AllowedOrigins: origins, AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag', 'Content-Length'], MaxAgeSeconds: 300,
}] } }));
const env = {
  TEST_BACKEND_ISOLATED: '1', TEST_SUPABASE_URL: status.API_URL, TEST_SUPABASE_ANON_KEY: status.ANON_KEY,
  TEST_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password,
  TEST_ADMIN_TOTP_SECRET: factor.data.totp.secret, TEST_R2_ACCOUNT_ID: storage.R2_ACCOUNT_ID || 'isolated',
  TEST_R2_ACCESS_KEY_ID: storage.R2_ACCESS_KEY_ID, TEST_R2_SECRET_ACCESS_KEY: storage.R2_SECRET_ACCESS_KEY,
  TEST_R2_ENDPOINT: storage.R2_ENDPOINT, TEST_R2_BUCKET_NAME: bucket, TEST_PORT: '3108', E2E_PORT: '3308',
};
writeFileSync(new URL('../.env.test.local', import.meta.url), Object.entries(env).map(([key,value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 });
console.log('PASS isolated migrations, backend marker, administrator TOTP and private test bucket; .env.test.local written without printing credentials');
