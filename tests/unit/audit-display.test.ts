import { describe, expect, it } from "vitest";

import { formatAuditMetadata } from "@/lib/audit-display";

/**
 * Round 8, part 2 — the compact metadata formatter.
 *
 * The table and the export share this, so the assertion pins the exact strings
 * an admin will see (never a raw JSON blob).
 */

describe("formatAuditMetadata", () => {
  it("renders nothing as a dash", () => {
    expect(formatAuditMetadata(null)).toBe("—");
    expect(formatAuditMetadata(undefined)).toBe("—");
    expect(formatAuditMetadata({})).toBe("—");
  });

  it("renders a partner create (name + tax code)", () => {
    expect(
      formatAuditMetadata({ name: "Công ty A", taxCode: "0312345678" }),
    ).toBe("Tên: Công ty A · MST: 0312345678");
  });

  it("renders a contract create (number + partner)", () => {
    expect(
      formatAuditMetadata({
        contractNumber: "HD-001",
        partnerName: "Công ty A",
      }),
    ).toBe("Số hợp đồng: HD-001 · Đối tác: Công ty A");
  });

  it("renders an update with the changed fields", () => {
    expect(
      formatAuditMetadata({ contractNumber: "HD-001", changed: ["notes", "expiryDate"] }),
    ).toBe("Số hợp đồng: HD-001 · Đã sửa: notes, expiryDate");
  });

  it("renders an import summary", () => {
    expect(formatAuditMetadata({ created: 2, failed: 1 })).toBe(
      "Đã nhập 2 · Lỗi 1",
    );
  });

  it("renders an upload with a human size", () => {
    expect(formatAuditMetadata({ filename: "hop-dong.pdf", size: 2048 })).toBe(
      "Tệp: hop-dong.pdf · Kích thước: 2 KB",
    );
  });

  it("falls back to compact key:value pairs, never a raw JSON blob", () => {
    const out = formatAuditMetadata({ email: "a@b.c", role: "admin" });
    expect(out).toBe("email: a@b.c · role: admin");
    expect(out).not.toContain("{");
  });
});
