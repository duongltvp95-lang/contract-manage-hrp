import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME_TYPES,
  CompleteUploadSchema,
  ContractFileSchema,
  FILE_KINDS,
  MAX_UPLOAD_SIZE_BYTES,
  PresignUploadSchema,
  UploadUrlRequestSchema,
  ViewUrlRequestSchema,
} from "@schemas/file";

/**
 * W1-WEB-038 — file validation (plan sections 38, 39, 74).
 */

const CONTRACT_ID = "35f5f865-4600-4b41-a828-af135a20c8a9";
const FILE_ID = "aefc9231-304e-4c26-8bf3-e1033cd70ee7";
const ORG_ID = "11111111-1111-1111-1111-111111111111";

describe("ALLOWED_MIME_TYPES (plan section 38)", () => {
  it("is exactly PDF, JPEG and PNG", () => {
    expect([...ALLOWED_MIME_TYPES]).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);
  });
});

describe("ContractFileSchema", () => {
  it("accepts each allowed type", () => {
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(
        ContractFileSchema.safeParse({ filename: "a.pdf", mimeType, fileSize: 1024 })
          .success,
      ).toBe(true);
    }
  });

  it("rejects a disallowed type", () => {
    const result = ContractFileSchema.safeParse({
      filename: "malware.exe",
      mimeType: "application/x-msdownload",
      fileSize: 10,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("không được hỗ trợ");
    }
  });

  it("rejects an empty or over-long filename", () => {
    const base = { mimeType: "application/pdf" as const, fileSize: 10 };
    expect(ContractFileSchema.safeParse({ ...base, filename: "   " }).success).toBe(false);
    expect(
      ContractFileSchema.safeParse({ ...base, filename: "x".repeat(256) }).success,
    ).toBe(false);
  });

  it("rejects a non-positive or fractional size", () => {
    const base = { filename: "a.pdf", mimeType: "application/pdf" as const };
    expect(ContractFileSchema.safeParse({ ...base, fileSize: 0 }).success).toBe(false);
    expect(ContractFileSchema.safeParse({ ...base, fileSize: -1 }).success).toBe(false);
    expect(ContractFileSchema.safeParse({ ...base, fileSize: 1.5 }).success).toBe(false);
  });

  it("enforces the upload ceiling (plan section 39)", () => {
    const base = { filename: "a.pdf", mimeType: "application/pdf" as const };
    expect(
      ContractFileSchema.safeParse({ ...base, fileSize: MAX_UPLOAD_SIZE_BYTES }).success,
    ).toBe(true);
    expect(
      ContractFileSchema.safeParse({ ...base, fileSize: MAX_UPLOAD_SIZE_BYTES + 1 })
        .success,
    ).toBe(false);
  });
});

describe("ContractFileSchema.kind (round 16)", () => {
  it("exposes exactly document + appendix", () => {
    expect([...FILE_KINDS]).toEqual(["document", "appendix"]);
  });

  it("accepts a PDF appendix", () => {
    expect(
      ContractFileSchema.safeParse({
        filename: "phu-luc.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        kind: "appendix",
      }).success,
    ).toBe(true);
  });

  it("rejects an image appendix (appendix must be PDF)", () => {
    for (const mimeType of ["image/jpeg", "image/png"] as const) {
      const result = ContractFileSchema.safeParse({
        filename: "phu-luc.jpg",
        mimeType,
        fileSize: 1024,
        kind: "appendix",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) =>
            issue.message.includes("Phụ lục chỉ chấp nhận file PDF"),
          ),
        ).toBe(true);
      }
    }
  });

  it("accepts a document of any allowed type, and defaults to document when kind is omitted", () => {
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(
        ContractFileSchema.safeParse({ filename: "a", mimeType, fileSize: 10, kind: "document" })
          .success,
      ).toBe(true);
      // Omitted kind → document (no appendix constraint).
      expect(
        ContractFileSchema.safeParse({ filename: "a", mimeType, fileSize: 10 }).success,
      ).toBe(true);
    }
  });

  it("rejects an unknown kind", () => {
    expect(
      ContractFileSchema.safeParse({
        filename: "a.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
        kind: "attachment",
      }).success,
    ).toBe(false);
  });
});

describe("UploadUrlRequestSchema", () => {
  it("requires a valid contract id", () => {
    expect(
      UploadUrlRequestSchema.safeParse({
        contractId: CONTRACT_ID,
        filename: "a.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
      }).success,
    ).toBe(true);

    expect(
      UploadUrlRequestSchema.safeParse({
        contractId: "not-a-uuid",
        filename: "a.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
      }).success,
    ).toBe(false);
  });

  it("drops an organizationId the client tries to supply", () => {
    // The service takes the organization from the session; a client-supplied
    // one must never survive validation.
    const parsed = UploadUrlRequestSchema.parse({
      contractId: CONTRACT_ID,
      filename: "a.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      organizationId: "22222222-2222-2222-2222-222222222222",
    });
    expect(parsed).not.toHaveProperty("organizationId");
  });
});

describe("CompleteUploadSchema", () => {
  it("requires fileId and objectKey", () => {
    expect(
      CompleteUploadSchema.safeParse({
        contractId: CONTRACT_ID,
        filename: "a.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
        objectKey: `contracts/${ORG_ID}/${CONTRACT_ID}/${FILE_ID}/a.pdf`,
      }).success,
    ).toBe(false); // fileId missing

    expect(
      CompleteUploadSchema.safeParse({
        contractId: CONTRACT_ID,
        fileId: FILE_ID,
        filename: "a.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
        objectKey: "",
      }).success,
    ).toBe(false); // objectKey empty
  });
});

describe("PresignUploadSchema", () => {
  it("accepts the seeded organization id that RFC 9562 would reject", () => {
    // 1111…-1111-… is format-valid but not a version-4 UUID; z.uuid() rejects it
    // while PostgreSQL's uuid type accepts it. Hence z.guid().
    const result = PresignUploadSchema.safeParse({
      organizationId: ORG_ID,
      contractId: CONTRACT_ID,
      filename: "a.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
    });
    expect(result.success).toBe(true);
  });
});

describe("ViewUrlRequestSchema (plan section 59)", () => {
  it("accepts a guid and rejects anything else", () => {
    expect(ViewUrlRequestSchema.safeParse({ fileId: FILE_ID }).success).toBe(true);
    expect(ViewUrlRequestSchema.safeParse({ fileId: "abc" }).success).toBe(false);
    expect(ViewUrlRequestSchema.safeParse({}).success).toBe(false);
  });

  it("ignores extra keys such as organizationId", () => {
    const parsed = ViewUrlRequestSchema.parse({
      fileId: FILE_ID,
      organizationId: ORG_ID,
    });
    expect(parsed).toEqual({ fileId: FILE_ID });
  });
});
