import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createUploadReservation, verifyUploadReservation } from "@/lib/services/upload-reservation";

describe("upload reservation signatures", () => {
  const previousSecret = process.env.UPLOAD_RESERVATION_SECRET;
  const payload = {
    userId: "user-1",
    organizationId: "11111111-1111-1111-1111-111111111111",
    contractId: "22222222-2222-2222-2222-222222222222",
    fileId: "33333333-3333-3333-3333-333333333333",
    objectKey: "contracts/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/main.pdf",
    filename: "main.pdf",
    mimeType: "application/pdf",
    fileSize: 1024,
    kind: "document" as const,
    baseContractNumber: "",
  };

  beforeEach(() => {
    process.env.UPLOAD_RESERVATION_SECRET = "test-only-secret";
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.UPLOAD_RESERVATION_SECRET;
    else process.env.UPLOAD_RESERVATION_SECRET = previousSecret;
  });

  it("accepts a reservation only for the exact user, object, and upload metadata", () => {
    const token = createUploadReservation(payload);
    expect(verifyUploadReservation(token, payload)).toBe(true);
    expect(verifyUploadReservation(token, { ...payload, userId: "user-2" })).toBe(false);
    expect(verifyUploadReservation(token, { ...payload, objectKey: `${payload.objectKey}.other` })).toBe(false);
    expect(verifyUploadReservation(`${token}x`, payload)).toBe(false);
  });
});
