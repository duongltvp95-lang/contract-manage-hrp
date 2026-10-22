import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { FileKind } from "@schemas/file";

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

export type UploadReservationPayload = {
  userId: string;
  organizationId: string;
  contractId: string;
  fileId: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  kind: FileKind;
  baseContractNumber: string;
  issuedAt: number;
};

function getSecret(): string {
  const secret = process.env.UPLOAD_RESERVATION_SECRET?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Missing upload reservation signing secret");
  return secret;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
}

export function createUploadReservation(payload: Omit<UploadReservationPayload, "issuedAt">): string {
  const encodedPayload = toBase64Url(JSON.stringify({ ...payload, issuedAt: Date.now() }));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyUploadReservation(
  token: string,
  expected: Omit<UploadReservationPayload, "issuedAt">,
): boolean {
  try {
    const [encodedPayload, suppliedSignature, extra] = token.split(".");
    if (!encodedPayload || !suppliedSignature || extra !== undefined) return false;

    const expectedSignature = sign(encodedPayload);
    const supplied = Buffer.from(suppliedSignature, "base64url");
    const actual = Buffer.from(expectedSignature, "base64url");
    if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) return false;

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as UploadReservationPayload;
    const age = Date.now() - payload.issuedAt;
    if (!Number.isFinite(payload.issuedAt) || age < -60_000 || age > RESERVATION_TTL_MS) return false;

    return payload.userId === expected.userId
      && payload.organizationId === expected.organizationId
      && payload.contractId === expected.contractId
      && payload.fileId === expected.fileId
      && payload.objectKey === expected.objectKey
      && payload.filename === expected.filename
      && payload.mimeType === expected.mimeType
      && payload.fileSize === expected.fileSize
      && payload.kind === expected.kind
      && payload.baseContractNumber === expected.baseContractNumber;
  } catch {
    return false;
  }
}
