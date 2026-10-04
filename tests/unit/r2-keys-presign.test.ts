import { describe, expect, it } from "vitest";

import { OBJECT_KEY_PREFIX, buildObjectKey, isObjectKeyFor, sanitizeFilename } from "@/lib/r2/keys";
import {
  UPLOAD_URL_TTL_SECONDS,
  VIEW_URL_TTL_MAX_SECONDS,
  VIEW_URL_TTL_MIN_SECONDS,
  VIEW_URL_TTL_SECONDS,
  clampViewTtl,
} from "@/lib/r2/presign";

/**
 * W1-WEB-010..013 — object key convention and TTL policy
 * (plan sections 37, 60).
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const CONTRACT = "35f5f865-4600-4b41-a828-af135a20c8a9";
const FILE = "aefc9231-304e-4c26-8bf3-e1033cd70ee7";

describe("sanitizeFilename (plan section 37)", () => {
  it("keeps Vietnamese diacritics intact", () => {
    expect(sanitizeFilename("Hợp đồng mẫu.pdf")).toBe("Hợp-đồng-mẫu.pdf");
  });

  it("drops any directory part, so a filename cannot climb out of its prefix", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\config")).toBe("config");
    expect(sanitizeFilename("/absolute/path/report.pdf")).toBe("report.pdf");
  });

  it("lowercases and strips the extension to [a-z0-9]", () => {
    expect(sanitizeFilename("INVOICE.PDF")).toBe("INVOICE.pdf");
    expect(sanitizeFilename("file.p<n>g")).toBe("file.png");
  });

  it("replaces characters that are meaningless in an object key", () => {
    expect(sanitizeFilename("a b  c.pdf")).toBe("a-b-c.pdf");
    expect(sanitizeFilename("a/b:c*d?e.pdf")).toBe("b-c-d-e.pdf");
  });

  it("never returns an empty stem", () => {
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename(".pdf")).toBe("pdf");
  });

  it("caps a very long stem", () => {
    expect(sanitizeFilename(`${"x".repeat(400)}.pdf`).length).toBeLessThanOrEqual(105);
  });
});

describe("buildObjectKey (plan section 37)", () => {
  it("follows contracts/{org}/{contract}/{file}/{filename}", () => {
    const key = buildObjectKey({
      organizationId: ORG,
      contractId: CONTRACT,
      fileId: FILE,
      filename: "Hợp đồng mẫu.pdf",
    });

    expect(key).toBe(`contracts/${ORG}/${CONTRACT}/${FILE}/Hợp-đồng-mẫu.pdf`);
    expect(key.split("/")).toHaveLength(5);
    expect(key.startsWith(`${OBJECT_KEY_PREFIX}/`)).toBe(true);
  });

  it("lowercases the ids so the key is stable", () => {
    const key = buildObjectKey({
      organizationId: ORG.toUpperCase(),
      contractId: CONTRACT.toUpperCase(),
      fileId: FILE.toUpperCase(),
      filename: "a.pdf",
    });
    expect(key).toContain(ORG);
    expect(key).toContain(CONTRACT);
  });

  it("refuses a non-UUID id, which is what stops a path-escape through an id", () => {
    expect(() =>
      buildObjectKey({
        organizationId: "../../etc",
        contractId: CONTRACT,
        fileId: FILE,
        filename: "a.pdf",
      }),
    ).toThrow(/organizationId/);

    expect(() =>
      buildObjectKey({
        organizationId: ORG,
        contractId: "a/b",
        fileId: FILE,
        filename: "a.pdf",
      }),
    ).toThrow(/contractId/);
  });

  it("keeps two organizations in disjoint prefixes", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const mine = buildObjectKey({
      organizationId: ORG,
      contractId: CONTRACT,
      fileId: FILE,
      filename: "a.pdf",
    });
    const theirs = buildObjectKey({
      organizationId: other,
      contractId: CONTRACT,
      fileId: FILE,
      filename: "a.pdf",
    });
    expect(mine.startsWith(`contracts/${ORG}/`)).toBe(true);
    expect(theirs.startsWith(`contracts/${ORG}/`)).toBe(false);
  });
});

describe("isObjectKeyFor — M8 hardening, fix 3", () => {
  const parts = { organizationId: ORG, contractId: CONTRACT, fileId: FILE };

  it("accepts a key built for exactly these ids", () => {
    const key = buildObjectKey({ ...parts, filename: "Hợp đồng mẫu.pdf" });
    expect(isObjectKeyFor(key, parts)).toBe(true);
  });

  it("accepts a different filename at the same location", () => {
    // The filename is the client's, so a mismatch there is not a mismatch.
    expect(
      isObjectKeyFor(`contracts/${ORG}/${CONTRACT}/${FILE}/anything.jpg`, parts),
    ).toBe(true);
  });

  it("rejects a key belonging to another organization", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    expect(
      isObjectKeyFor(`contracts/${other}/${CONTRACT}/${FILE}/a.pdf`, parts),
    ).toBe(false);
  });

  it("rejects a key belonging to another contract or file", () => {
    expect(
      isObjectKeyFor(`contracts/${ORG}/${FILE}/${FILE}/a.pdf`, parts),
    ).toBe(false);
    expect(
      isObjectKeyFor(`contracts/${ORG}/${CONTRACT}/${CONTRACT}/a.pdf`, parts),
    ).toBe(false);
  });

  it("rejects a key with no filename segment", () => {
    expect(isObjectKeyFor(`contracts/${ORG}/${CONTRACT}/${FILE}/`, parts)).toBe(false);
  });

  it("rejects a key that climbs out of the prefix", () => {
    expect(
      isObjectKeyFor(`contracts/${ORG}/${CONTRACT}/${FILE}/../secret.pdf`, parts),
    ).toBe(false);
    expect(
      isObjectKeyFor(`contracts/${ORG}/${CONTRACT}/${FILE}/..`, parts),
    ).toBe(false);
    expect(
      isObjectKeyFor(`contracts/${ORG}/${CONTRACT}/${FILE}/nested/a.pdf`, parts),
    ).toBe(false);
  });

  it("rejects a plain key from somewhere else entirely", () => {
    expect(isObjectKeyFor("contracts/whatever", parts)).toBe(false);
    expect(isObjectKeyFor("", parts)).toBe(false);
  });

  it("answers false rather than throwing when an id is not a UUID", () => {
    expect(
      isObjectKeyFor(`contracts/${ORG}/${CONTRACT}/${FILE}/a.pdf`, {
        ...parts,
        organizationId: "../../etc",
      }),
    ).toBe(false);
  });
});

describe("presigned URL TTLs (plan section 60)", () => {
  it("clamps a view TTL into the 5-15 minute window", () => {
    expect(clampViewTtl(1)).toBe(VIEW_URL_TTL_MIN_SECONDS);
    expect(clampViewTtl(0)).toBe(VIEW_URL_TTL_MIN_SECONDS);
    expect(clampViewTtl(-100)).toBe(VIEW_URL_TTL_MIN_SECONDS);
    expect(clampViewTtl(VIEW_URL_TTL_MIN_SECONDS)).toBe(VIEW_URL_TTL_MIN_SECONDS);
    expect(clampViewTtl(600)).toBe(600);
    expect(clampViewTtl(VIEW_URL_TTL_MAX_SECONDS + 1)).toBe(VIEW_URL_TTL_MAX_SECONDS);
    expect(clampViewTtl(86_400)).toBe(VIEW_URL_TTL_MAX_SECONDS);
  });

  it("falls back to the default for a non-finite request", () => {
    expect(clampViewTtl(Number.NaN)).toBe(VIEW_URL_TTL_SECONDS);
    expect(clampViewTtl(Number.POSITIVE_INFINITY)).toBe(VIEW_URL_TTL_SECONDS);
  });

  it("truncates a fractional TTL", () => {
    expect(clampViewTtl(600.9)).toBe(600);
  });

  it("keeps the default inside the allowed window", () => {
    expect(VIEW_URL_TTL_SECONDS).toBeGreaterThanOrEqual(VIEW_URL_TTL_MIN_SECONDS);
    expect(VIEW_URL_TTL_SECONDS).toBeLessThanOrEqual(VIEW_URL_TTL_MAX_SECONDS);
  });

  it("gives uploads a shorter window than the maximum view TTL", () => {
    expect(UPLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(VIEW_URL_TTL_MAX_SECONDS);
  });
});
