import { z } from "zod";

/**
 * Shared file schemas — plan sections 14, 38, 39, 74.
 *
 * Two levels:
 * - `ContractFileSchema` describes one file the browser is about to upload.
 * - `PresignUploadSchema` is that plus the owning ids, and is what the server
 *   validates before issuing a presigned URL.
 *
 * No AWS Signature V4 code lives here — see `lib/r2/presign.ts`.
 */

/** Plan section 38 — only PDF, JPG/JPEG and PNG are accepted. */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Plan section 39 — MAX_UPLOAD_SIZE_MB, never hard-coded in a component. */
export const DEFAULT_MAX_UPLOAD_SIZE_MB = 50;

const configuredMaxMb = Number(process.env.MAX_UPLOAD_SIZE_MB);

export const MAX_UPLOAD_SIZE_MB =
  Number.isFinite(configuredMaxMb) && configuredMaxMb > 0
    ? configuredMaxMb
    : DEFAULT_MAX_UPLOAD_SIZE_MB;

export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

export const MIME_TYPE_ERROR = `Định dạng tệp không được hỗ trợ. Chỉ chấp nhận: ${ALLOWED_MIME_TYPES.join(", ")}`;
export const FILE_SIZE_ERROR = `Tệp vượt quá giới hạn ${MAX_UPLOAD_SIZE_MB} MB`;

/**
 * NOTE: `MAX_UPLOAD_SIZE_MB` is a server variable (no NEXT_PUBLIC_ prefix), so
 * in a Client Component bundle it is `undefined` and the limit silently falls
 * back to the default. The server stays authoritative; the upload UI is told
 * the limit through the presign response.
 */

/** Metadata of a single file the browser holds in memory. */
export const ContractFileSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, "Tên tệp không được để trống")
    .max(255, "Tên tệp quá dài"),

  mimeType: z.enum(ALLOWED_MIME_TYPES, { error: MIME_TYPE_ERROR }),

  fileSize: z
    .number()
    .int()
    .positive("Kích thước tệp không hợp lệ")
    .max(MAX_UPLOAD_SIZE_BYTES, FILE_SIZE_ERROR),
});

export type ContractFileInput = z.infer<typeof ContractFileSchema>;

/**
 * What the browser sends to `POST /api/files/upload-url`.
 *
 * `organizationId` is deliberately absent: the server takes it from the
 * session. Trusting a client-supplied organization would let any user write
 * into another tenant.
 */
export const UploadUrlRequestSchema = ContractFileSchema.extend({
  contractId: z.guid({ error: "contractId không hợp lệ" }),
});

export type UploadUrlRequestInput = z.infer<typeof UploadUrlRequestSchema>;

/**
 * What the browser sends back after the PUT to R2 succeeded.
 *
 * Same reasoning as above: `organizationId` and the user id are added by the
 * server from the session.
 */
export const CompleteUploadSchema = UploadUrlRequestSchema.extend({
  fileId: z.guid({ error: "fileId không hợp lệ" }),
  objectKey: z
    .string()
    .min(1, "objectKey không được để trống")
    .max(1024, "objectKey quá dài"),
});

export type CompleteUploadInput = z.infer<typeof CompleteUploadSchema>;

/** What the browser sends to `POST /api/files/view-url` (plan section 59). */
export const ViewUrlRequestSchema = z.object({
  fileId: z.guid({ error: "fileId không hợp lệ" }),
});

export type ViewUrlRequestInput = z.infer<typeof ViewUrlRequestSchema>;

/**
 * Full server-side presign payload, including the ids that the service layer
 * fills in from the session.
 *
 * `organizationId` / `contractId` use `z.guid()` rather than `z.uuid()`:
 * `z.uuid()` validates RFC 9562 version and variant bits, while PostgreSQL's
 * `uuid` type is format-only. The seeded default organization id
 * (`11111111-1111-1111-1111-111111111111`, see the M2 migration) is accepted by
 * PostgreSQL but rejected by `z.uuid()`.
 */
export const PresignUploadSchema = UploadUrlRequestSchema.extend({
  organizationId: z.guid({ error: "organizationId không hợp lệ" }),
});

export type PresignUploadInput = z.infer<typeof PresignUploadSchema>;
