import "server-only";

/**
 * Object key convention — plan section 37:
 *
 *   contracts/{organization_id}/{contract_id}/{file_id}/{filename}
 *
 * The bucket name is configuration (R2_BUCKET_NAME); the key prefix stays
 * `contracts/` regardless, so switching buckets never rewrites stored keys.
 */

export const OBJECT_KEY_PREFIX = "contracts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_STEM_LENGTH = 100;
const MAX_EXTENSION_LENGTH = 10;

/**
 * Makes an uploaded filename safe to use as the last path segment.
 *
 * - Any directory part is dropped: a filename must never be able to change the
 *   key layout or climb out of it (`../../etc/passwd`).
 * - Vietnamese diacritics are preserved (`\p{L}` covers them); only characters
 *   that are unsafe or meaningless in a key become `-`.
 * - The extension is kept, lowercased and stripped to `[a-z0-9]`.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const trimmed = base.trim().normalize("NFC");

  const lastDot = trimmed.lastIndexOf(".");
  const hasExtension = lastDot > 0 && lastDot < trimmed.length - 1;

  const rawStem = hasExtension ? trimmed.slice(0, lastDot) : trimmed;
  const rawExtension = hasExtension ? trimmed.slice(lastDot + 1) : "";

  const extension = rawExtension
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_EXTENSION_LENGTH);

  const stem =
    rawStem
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^[._-]+/, "")
      .replace(/[._-]+$/, "")
      .replace(/-{2,}/g, "-")
      .slice(0, MAX_STEM_LENGTH) || "file";

  return extension ? `${stem}.${extension}` : stem;
}

export type ObjectKeyParts = {
  organizationId: string;
  contractId: string;
  fileId: string;
  filename: string;
};

function assertUuid(value: string, field: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`${field} phải là UUID hợp lệ (nhận được: ${value})`);
  }
  return value.toLowerCase();
}

/**
 * `contracts/{organizationId}/{contractId}/{fileId}/{sanitizedFilename}`
 *
 * The three ids are validated as UUIDs first, so a caller can never inject `/`
 * or `..` through an id and escape the organization's prefix.
 */
export function buildObjectKey({
  organizationId,
  contractId,
  fileId,
  filename,
}: ObjectKeyParts): string {
  const org = assertUuid(organizationId, "organizationId");
  const contract = assertUuid(contractId, "contractId");
  const file = assertUuid(fileId, "fileId");
  const safeName = sanitizeFilename(filename);

  return `${OBJECT_KEY_PREFIX}/${org}/${contract}/${file}/${safeName}`;
}

/**
 * Is `objectKey` the key this file is *supposed* to live at?
 *
 * `buildObjectKey()` is the only thing that creates keys, so the shape is known
 * exactly: `contracts/{org}/{contract}/{file}/` followed by a sanitized
 * filename. Only the prefix is compared, because the filename is the client's
 * and may legitimately differ from whatever a caller guesses.
 *
 * This matters in both directions:
 *   - after an upload, the client hands the key back and must not be able to
 *     point the row at a key it merely happens to know;
 *   - before signing a view URL, the stored key must still belong to the ids in
 *     the row, or a row that was re-pointed (by hand, or by a future bug) would
 *     become a way to read an arbitrary object out of the bucket.
 *
 * Ids are validated as UUIDs and compared lower-cased, so a value containing `/`
 * or `..` cannot be smuggled in as a path segment.
 */
export function isObjectKeyFor(
  objectKey: string,
  { organizationId, contractId, fileId }: Omit<ObjectKeyParts, "filename">,
): boolean {
  let prefix: string;

  try {
    prefix = `${OBJECT_KEY_PREFIX}/${assertUuid(organizationId, "organizationId")}/${assertUuid(contractId, "contractId")}/${assertUuid(fileId, "fileId")}/`;
  } catch {
    // A non-UUID id is a programming error rather than a data condition.
    // Answering "no" keeps this total instead of throwing inside a request path.
    return false;
  }

  if (!objectKey.startsWith(prefix)) return false;

  // Exactly one more segment, and nothing that could climb out of the prefix.
  const rest = objectKey.slice(prefix.length);
  return (
    rest.length > 0 &&
    !rest.includes("/") &&
    !rest.includes("\\") &&
    rest !== ".."
  );
}
