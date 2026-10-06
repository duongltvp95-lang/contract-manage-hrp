import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { ADMIN_EMAIL, ADMIN_PASSWORD, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from "../setup/env";
import { ORG_A, ORG_B, TEST_PREFIX } from "./config";

/**
 * Fixtures for the integration suite — W1-WEB-039/040.
 *
 * Every row the suite creates is prefixed `W1TEST-` and removed in `afterAll`,
 * so a failing run cannot leave a contract behind. The tests run against the
 * real Supabase project and the real R2 bucket: that is the point, because RLS
 * and IAM behaviour cannot be reproduced by a mock.
 */

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function r2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
}

export function bucketName(): string {
  return process.env.R2_BUCKET_NAME ?? "";
}

export const hasR2 = () =>
  Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );

/** A signed-in user, plus the cookies their browser would send. */
export type TestSession = {
  userId: string;
  email: string;
  password: string;
  cookie: string;
  client: SupabaseClient;
};

function makeCookieSession() {
  const jar = new Map<string, string>();

  const client = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });

  const cookie = () =>
    [...jar.entries()]
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");

  return { client, cookie };
}

/** Signs in with a cookie session, for tests that need a second identity. */
export async function signInAs(email: string, password: string): Promise<TestSession> {
  const { client, cookie } = makeCookieSession();
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);

  const { data } = await client.auth.getUser();

  return {
    userId: data.user?.id ?? "",
    email,
    password,
    cookie: cookie(),
    client,
  };
}

/** Signs in as the account the suites use as the administrator (org A). */
export async function signInAsAdmin(): Promise<TestSession> {
  return signInAs(ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Creates a throwaway second tenant with one confirmed user.
 *
 * The user is created through the admin API (email pre-confirmed) because the
 * public sign-up flow is deliberately disabled (owner decision, Part 0).
 */
export async function createSecondTenant(
  admin: SupabaseClient,
  label: string,
): Promise<TestSession> {
  const email = `w1test.${label}.${Date.now().toString(36)}@hrpartner.test`;
  const password = `W1Test-${Math.random().toString(36).slice(2, 12)}!aA1`;

  // The organization row has to exist first: profiles.organization_id references
  // organizations(id), so moving the user without it fails the foreign key.
  const { error: orgError } = await admin
    .from("organizations")
    .upsert({ id: ORG_B, name: "W1TEST organization" }, { onConflict: "id" });

  if (orgError) {
    throw new Error(`could not create the test organization: ${orgError.message}`);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`could not create the second tenant user: ${error?.message}`);
  }

  // The handle_new_user trigger puts the profile in the default organization;
  // moving it is what makes this a different tenant. The error is checked —
  // a silently ignored failure here would leave the "other tenant" inside org A
  // and every RLS assertion would then pass for the wrong reason.
  const { error: moveError } = await admin
    .from("profiles")
    .update({ organization_id: ORG_B })
    .eq("id", data.user.id);

  if (moveError) {
    throw new Error(`could not move the user into the test organization: ${moveError.message}`);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", data.user.id)
    .single();

  if (profile?.organization_id !== ORG_B) {
    throw new Error(
      `the second tenant is still in ${profile?.organization_id}; RLS tests would be meaningless`,
    );
  }

  const { client, cookie } = makeCookieSession();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    throw new Error(`second tenant sign-in failed: ${signInError.message}`);
  }

  return { userId: data.user.id, email, password, cookie: cookie(), client };
}

export type SeededPartner = {
  id: string;
  name: string;
  cleanup: () => Promise<void>;
};

/**
 * One partner row in `organizationId` (feature round 2).
 *
 * The row is inserted with the service role, which bypasses RLS: the RLS rules
 * themselves are what the partners suite asserts, so the fixtures must not
 * depend on them.
 */
export async function seedPartner(
  admin: SupabaseClient,
  {
    organizationId,
    name,
    address,
    taxCode,
  }: { organizationId: string; name: string; address?: string; taxCode?: string },
): Promise<SeededPartner> {
  const { data, error } = await admin
    .from("partners")
    .insert({
      organization_id: organizationId,
      name,
      address: address ?? null,
      tax_code: taxCode ?? null,
    })
    .select("id, name")
    .single();

  if (error || !data) {
    throw new Error(`could not seed the partner: ${error?.message}`);
  }

  return {
    id: data.id as string,
    name: data.name as string,
    cleanup: async () => {
      await admin.from("partners").delete().eq("id", data.id);
    },
  };
}

export type SeededFile = {
  contractId: string;
  fileId: string;
  objectKey: string;
  cleanup: () => Promise<void>;
};

/**
 * One contract in `organizationId` with one real object in R2.
 *
 * The row is inserted directly rather than through the API because the suite is
 * testing authorization, not the create flow (that is the end-to-end suite's
 * job). The object is a real upload so a presigned GET can actually be fetched.
 *
 * `partnerId` (feature round 2) links the contract to a partner row; omit it for
 * the free-text-only contracts that every Wave 1 row looks like.
 */
export async function seedContractWithFile(
  admin: SupabaseClient,
  {
    organizationId,
    label,
    withObject,
    partnerId,
  }: {
    organizationId: string;
    label: string;
    withObject: boolean;
    partnerId?: string;
  },
): Promise<SeededFile> {
  const contractId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const filename = `${TEST_PREFIX}${label}.pdf`;
  const objectKey = `contracts/${organizationId}/${contractId}/${fileId}/${filename}`;

  const { error: contractError } = await admin.from("contracts").insert({
    id: contractId,
    organization_id: organizationId,
    contract_number: `${TEST_PREFIX}${label}`,
    signed_date: "2026-01-15",
    expiry_date: "2027-01-14",
    partner_text: "W1TEST partner",
    partner_id: partnerId ?? null,
  });

  if (contractError) {
    throw new Error(`could not seed the contract: ${contractError.message}`);
  }

  let fileSize = 0;

  if (withObject && hasR2()) {
    const body = Buffer.from(
      `%PDF-1.4\n% ${TEST_PREFIX}${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
      "latin1",
    );
    fileSize = body.length;

    await r2Client().send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: objectKey,
        Body: body,
        ContentType: "application/pdf",
      }),
    );
  }

  const { error: fileError } = await admin.from("contract_files").insert({
    id: fileId,
    organization_id: organizationId,
    contract_id: contractId,
    storage_provider: "r2",
    bucket: bucketName(),
    object_key: objectKey,
    original_filename: filename,
    mime_type: "application/pdf",
    file_size: fileSize,
  });

  if (fileError) {
    throw new Error(`could not seed the file row: ${fileError.message}`);
  }

  return {
    contractId,
    fileId,
    objectKey,
    cleanup: async () => {
      if (hasR2()) {
        try {
          await r2Client().send(
            new DeleteObjectCommand({ Bucket: bucketName(), Key: objectKey }),
          );
        } catch {
          /* already gone */
        }
      }
      await admin.from("contract_files").delete().eq("id", fileId);
      await admin.from("contracts").delete().eq("id", contractId);
    },
  };
}

/**
 * Creates a fresh user in `organizationId` with the given role, confirmed and
 * ready to sign in.
 *
 * Used by the round 3 part 1 suite to spin up a second administrator without
 * going through the public sign-up form (which is disabled in this project).
 * The user is created through the admin API; the profile is then moved to
 * `organizationId` so the "organization match" check in the service passes.
 */
export async function createTestUser(
  admin: SupabaseClient,
  {
    organizationId,
    role,
    label,
  }: {
    organizationId: string;
    role: "user" | "admin";
    label: string;
  },
): Promise<{ id: string; email: string; password: string }> {
  const email = `w1test.${label}.${Date.now().toString(36)}.${crypto
    .randomUUID()
    .slice(0, 8)}@hrpartner.test`;
  const password = `W1Test-${Math.random().toString(36).slice(2, 12)}!aA1`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${TEST_PREFIX}${label}` },
  });

  if (error || !data?.user) {
    throw new Error(
      `could not create test user ${label}: ${error?.message ?? "no user"}`,
    );
  }

  // The handle_new_user trigger puts the profile in the default organization;
  // we move it to the requested one so RLS and organization checks see the
  // right tenant.
  const { error: moveError } = await admin
    .from("profiles")
    .update({ organization_id: organizationId, role, is_active: true })
    .eq("id", data.user.id);

  if (moveError) {
    // Roll back the auth row so a failed setup does not leave a half-built
    // account behind.
    await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw new Error(
      `could not move ${label} into the test organization: ${moveError.message}`,
    );
  }

  return { id: data.user.id, email, password };
}

/**
 * Signs a freshly-created test user in, returning a cookie session.
 *
 * The user was created by `createTestUser` with a known password; this is the
 * matching sign-in so the suite can call protected routes as that user.
 */
export async function signInNewUser(
  email: string,
  password: string,
): Promise<TestSession> {
  return signInAs(email, password);
}


export async function destroySecondTenant(
  admin: SupabaseClient,
  session: TestSession,
): Promise<void> {
  // Anything the suite created inside the second tenant goes first: contracts
  // reference the organization, so the organization cannot be removed while
  // they exist.
  const { data: contracts } = await admin
    .from("contracts")
    .select("id")
    .eq("organization_id", ORG_B);

  for (const contract of contracts ?? []) {
    const { data: files } = await admin
      .from("contract_files")
      .select("object_key")
      .eq("contract_id", contract.id);

    if (hasR2()) {
      for (const file of files ?? []) {
        try {
          await r2Client().send(
            new DeleteObjectCommand({ Bucket: bucketName(), Key: file.object_key }),
          );
        } catch {
          /* already gone */
        }
      }
    }

    await admin.from("contract_files").delete().eq("contract_id", contract.id);
    await admin.from("contracts").delete().eq("id", contract.id);
  }

  // Contracts go first (they reference partners), then the partner rows, then
  // the organization itself: every one of those foreign keys is RESTRICT, so the
  // order is not a preference.
  const { data: partners } = await admin
    .from("partners")
    .select("id")
    .eq("organization_id", ORG_B);

  for (const partner of partners ?? []) {
    await admin.from("partners").delete().eq("id", partner.id);
  }

  await admin.from("profiles").update({ organization_id: ORG_A }).eq("id", session.userId);
  await admin.auth.admin.deleteUser(session.userId);
  await admin.from("organizations").delete().eq("id", ORG_B);
}

/**
 * Safety net: removes every `W1TEST-` contract regardless of how the run ended,
 * plus any leftover second tenant users.
 */
export async function sweepTestRows(admin: SupabaseClient): Promise<void> {
  const { data: contracts } = await admin
    .from("contracts")
    .select("id, organization_id")
    .like("contract_number", `${TEST_PREFIX}%`);

  for (const contract of contracts ?? []) {
    const { data: files } = await admin
      .from("contract_files")
      .select("object_key")
      .eq("contract_id", contract.id);

    if (hasR2()) {
      for (const file of files ?? []) {
        try {
          await r2Client().send(
            new DeleteObjectCommand({ Bucket: bucketName(), Key: file.object_key }),
          );
        } catch {
          /* already gone */
        }
      }
    }

    await admin.from("contract_files").delete().eq("contract_id", contract.id);
    await admin.from("contracts").delete().eq("id", contract.id);
  }

  // Partners last: a contract that still pointed at one would block the delete
  // (ON DELETE RESTRICT), which is exactly the behaviour the migration intends.
  const { data: partners } = await admin
    .from("partners")
    .select("id")
    .like("name", `${TEST_PREFIX}%`);

  for (const partner of partners ?? []) {
    await admin.from("partners").delete().eq("id", partner.id);
  }

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of users?.users ?? []) {
    if (user.email?.includes("w1test.")) {
      await admin.from("profiles").update({ organization_id: ORG_A }).eq("id", user.id);
      await admin.auth.admin.deleteUser(user.id);
    }
  }
}
