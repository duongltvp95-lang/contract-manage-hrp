import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, type Page, type Response } from "@playwright/test";
import zlib from "node:zlib";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared fixtures for the end-to-end suite — W1-WEB-039..043.
 *
 * Everything here is deliberately explicit about the real services: the tests
 * run against the live Supabase project and the live R2 bucket, because that is
 * where the behaviour under test actually lives.
 */

export const ORG_A = "11111111-1111-1111-1111-111111111111";
export const ORG_B = "22222222-2222-2222-2222-222222222222";
export const TEST_PREFIX = "E2ETEST-";

/**
 * The account the suite signs in as.
 *
 * No fallback values, deliberately: an earlier revision defaulted the password
 * to the live admin credential, which committed a working production password
 * to the repository. A test that cannot run without a secret must skip, not
 * carry the secret in source.
 */
export const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
export const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";

/**
 * True when this suite can actually reach Supabase and R2.
 *
 * Every spec calls `test.skip(!hasLiveBackend, …)` at file scope, so a checkout
 * without credentials (a fork, or CI on a repository with no secrets) reports
 * the suite as skipped rather than failing it. That is also why the CI workflow
 * needs no `if:` on its jobs — and why it must not have one, since `secrets` is
 * not an allowed context in a job-level condition.
 */
export const hasLiveBackend = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    ADMIN_EMAIL &&
    ADMIN_PASSWORD,
);

/** Where generated PDF/PNG/JPG fixtures are written for the file inputs. */
export const ARTIFACT_DIR = join(tmpdir(), "contract-manager-e2e");

export function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
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

export const bucketName = () => process.env.R2_BUCKET_NAME ?? "";

// ---------------------------------------------------------------------------
// Generated fixtures
// ---------------------------------------------------------------------------

/** A real, valid multi-page PDF — so "next page" has somewhere to go. */
export function buildPdf(pageCount: number, label: string): Buffer {
  const objects: Record<number, string> = {};
  const pageIds: number[] = [];
  const fontId = 3;
  let next = 4;

  for (let index = 0; index < pageCount; index += 1) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);

    const text = `BT /F1 24 Tf 60 400 Td (${label} - page ${index + 1} / ${pageCount}) Tj ET`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents ${contentId} 0 R ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const maxId = next - 1;
  let pdf = "%PDF-1.4\n";
  const offsets: Record<number, number> = {};

  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const startxref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/** A real PNG, built here so the suite needs no binary fixture in the repo. */
export function buildPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
    }
  }

  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A minimal but structurally valid JPEG (SOI + APP0/JFIF + EOI). */
export function buildJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

/** Writes a generated buffer to the artefact directory and returns its path. */
export function writeArtifact(name: string, contents: Buffer): string {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const path = join(ARTIFACT_DIR, name);
  writeFileSync(path, contents);
  return path;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");

export function isoDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `2026-10-03` -> `03/10/2026`, the format the UI renders. */
export function dmy(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

/**
 * Waits until the Next.js client runtime has booted and React has had a beat to
 * hydrate the page.
 *
 * Interacting with a form before hydration completes loses input: React resets
 * uncontrolled fields to their server-rendered values during hydration, so a
 * fill + submit that "worked" reads an empty field and the page does nothing
 * visible. Locally the window is tiny; against a streaming production page
 * (Vercel) it is real — this is exactly what made the search test flake on the
 * deployed app: fill → submit → URL unchanged.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { next?: { version?: string } }).next?.version),
    undefined,
    { timeout: 30_000 },
  );
  // A short beat for React 19's concurrent hydration to finish attaching
  // handlers after the runtime reports in.
  await page.waitForTimeout(400);
}

/**
 * `page.goto()` followed by `waitForHydration()` — the safe way to navigate
 * before interacting with the page. Returns the navigation response, like
 * `page.goto` does, for the few tests that read the status.
 */
export async function gotoAndSettle(
  page: Page,
  url: string,
): Promise<Response | null> {
  const response = await page.goto(url);
  await waitForHydration(page);
  return response;
}

export async function login(
  page: Page,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<void> {
  await gotoAndSettle(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.getByRole("button", { name: /đăng nhập/i }).click(),
  ]);
}

/**
 * Clicks something that may sit inside the Sheet's scroll container.
 * Playwright's actionability check occasionally refuses a node that is still
 * animating in, and this keeps the suite about the application rather than
 * about hit-testing.
 */
export async function clickSafe(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ORDINALS = ["th", "st", "nd", "rd"];

function ordinal(day: number): string {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  return `${day}${ORDINALS[day % 10] ?? "th"}`;
}

/**
 * Picks a `YYYY-MM-DD` date in the shadcn calendar.
 *
 * Two things make this fiddlier than it looks, and both cost a debugging round:
 *
 *   - react-day-picker puts `data-day` on BOTH the `<td>` (ISO, `2026-11-17`)
 *     and the `<button>` (`11/17/2026`). Selecting by that attribute risks
 *     matching the wrong node, so the button is found by its accessible name
 *     instead — `"Tuesday, November 17th, 2026"`, which is unambiguous.
 *   - the month has to be awaited after each navigation click, or the loop
 *     clicks "next month" faster than the calendar re-renders.
 */
export async function pickDate(page: Page, iso: string): Promise<void> {
  const [year, month, day] = iso.split("-").map(Number);
  const targetIndex = year * 12 + (month - 1);

  const caption = page
    .locator('[data-radix-popper-content-wrapper] [class*="caption"]')
    .first();
  await caption.waitFor({ state: "visible" });

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const label = (await caption.textContent())?.trim() ?? "";
    const [captionMonth, captionYear] = label.split(" ");
    const currentIndex = Number(captionYear) * 12 + MONTHS.indexOf(captionMonth);

    if (currentIndex === targetIndex) break;
    if (!Number.isFinite(currentIndex)) {
      throw new Error(`could not read the calendar month from ${JSON.stringify(label)}`);
    }

    await page
      .getByRole("button", {
        name: currentIndex < targetIndex ? "Go to the Next Month" : "Go to the Previous Month",
      })
      .click();

    // Wait for the caption to actually change before deciding again.
    await expect
      .poll(async () => (await caption.textContent())?.trim(), { timeout: 10_000 })
      .not.toBe(label);
  }

  const dayButton = page.getByRole("button", {
    name: new RegExp(`${MONTHS[month - 1]} ${ordinal(day)}, ${year}`),
  });

  await dayButton.click();
}

/**
 * Matches the presigned R2 requests, for tests that need to slow one down or
 * make it fail.
 *
 * A regex rather than a glob on purpose: the literal host is
 * `<account>.r2.cloudflarestorage.com`, and the obvious glob
 * `**‌/r2.cloudflarestorage.com/**` never matches it — the character before `r2`
 * is a dot, not a slash. Getting that wrong makes an interception test pass
 * without intercepting anything.
 */
export const R2_REQUEST = /r2\.cloudflarestorage\.com/;

/** Waits for the contract detail page and returns its id. */
export async function waitForContractDetail(page: Page): Promise<string> {
  await page.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 120_000 });
  return page.url().split("/").pop() as string;
}

/** Replaces a field's contents; triple-click alone does not always select. */
export async function setInput(page: Page, selector: string, value: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.click();
  await locator.press("ControlOrMeta+a");
  await locator.press("Backspace");
  await locator.fill(value);
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

export type SeededContract = {
  id: string;
  contractNumber: string;
  cleanup: () => Promise<void>;
};

/**
 * Deletes a contract, its file rows AND their objects.
 *
 * The objects matter: deleting only the rows leaves the bucket littered with
 * orphaned bytes, which is exactly the "no leftover test data" requirement of
 * W1-WEB-042. Every teardown goes through here.
 */
export async function purgeContract(
  admin: SupabaseClient,
  contractId: string,
): Promise<void> {
  const { data: files } = await admin
    .from("contract_files")
    .select("object_key")
    .eq("contract_id", contractId);

  for (const file of files ?? []) {
    try {
      await r2Client().send(
        new DeleteObjectCommand({ Bucket: bucketName(), Key: file.object_key }),
      );
    } catch {
      /* already gone */
    }
  }

  await admin.from("contract_files").delete().eq("contract_id", contractId);
  await admin.from("contracts").delete().eq("id", contractId);
}

/**
 * Creates contracts directly, for the cases where the point is what the *list*
 * does with many rows rather than how a row is created.
 */
export async function seedContracts(
  admin: SupabaseClient,
  rows: {
    organizationId: string;
    contractNumber: string;
    partnerText: string;
    signedDate: string | null;
    expiryDate: string | null;
    durationText?: string | null;
  }[],
): Promise<SeededContract[]> {
  const { data, error } = await admin
    .from("contracts")
    .insert(
      rows.map((row) => ({
        organization_id: row.organizationId,
        contract_number: row.contractNumber,
        partner_text: row.partnerText,
        signed_date: row.signedDate,
        expiry_date: row.expiryDate,
        duration_text: row.durationText ?? null,
      })),
    )
    .select("id, contract_number");

  if (error) throw new Error(`could not seed contracts: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    contractNumber: row.contract_number as string,
    cleanup: () => purgeContract(admin, row.id as string),
  }));
}

/** Attaches a file row plus its real R2 object to an existing contract. */
export async function attachFile(
  admin: SupabaseClient,
  {
    organizationId,
    contractId,
    filename,
    mimeType,
    body,
  }: {
    organizationId: string;
    contractId: string;
    filename: string;
    mimeType: string;
    body: Buffer;
  },
): Promise<{ fileId: string; objectKey: string; cleanup: () => Promise<void> }> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");

  const fileId = crypto.randomUUID();
  const objectKey = `contracts/${organizationId}/${contractId}/${fileId}/${filename}`;

  await r2Client().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: objectKey,
      Body: body,
      ContentType: mimeType,
    }),
  );

  const { error } = await admin.from("contract_files").insert({
    id: fileId,
    organization_id: organizationId,
    contract_id: contractId,
    storage_provider: "r2",
    bucket: bucketName(),
    object_key: objectKey,
    original_filename: filename,
    mime_type: mimeType,
    file_size: body.length,
  });

  if (error) throw new Error(`could not attach the file: ${error.message}`);

  return {
    fileId,
    objectKey,
    cleanup: async () => {
      try {
        await r2Client().send(
          new DeleteObjectCommand({ Bucket: bucketName(), Key: objectKey }),
        );
      } catch {
        /* already gone */
      }
      await admin.from("contract_files").delete().eq("id", fileId);
    },
  };
}

/** Removes everything the suite created, however the run ended. */
export async function sweep(admin: SupabaseClient): Promise<void> {
  const { data: contracts } = await admin
    .from("contracts")
    .select("id")
    .like("contract_number", `${TEST_PREFIX}%`);

  for (const contract of contracts ?? []) {
    await purgeContract(admin, contract.id);
  }
}

/** Counts the objects the suite owns, to prove nothing was left in R2. */
export async function countTestObjects(): Promise<number> {
  const list = await r2Client().send(
    new ListObjectsV2Command({ Bucket: bucketName(), Prefix: "contracts/" }),
  );

  return (list.Contents ?? []).filter((object) => object.Key?.includes(TEST_PREFIX))
    .length;
}

/** A unique suffix so parallel-ish runs and reruns never collide. */
export function runId(): string {
  return Date.now().toString(36);
}

export function readFixture(path: string): Buffer {
  return readFileSync(path);
}

export { expect };
