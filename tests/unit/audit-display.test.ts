import { describe, expect, it } from "vitest";

import { formatAuditMetadata, formatAuditSentence } from "@/lib/audit-display";
import type { AuditAction } from "@schemas/audit-log";

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

describe("formatAuditSentence", () => {
  const actor = "Khương Văn Đường";
  const say = (action: AuditAction, metadata: Record<string, unknown>, actorName: string | null = actor) =>
    formatAuditSentence({ actorName, action, metadata });

  it("builds a sentence for every action", () => {
    expect(say("create_partner", { name: "Công ty A" })).toBe(
      'Khương Văn Đường đã thêm đối tác “Công ty A”',
    );
    expect(say("update_partner", { name: "Công ty A" })).toBe(
      'Khương Văn Đường đã sửa đối tác “Công ty A”',
    );
    expect(say("import_partners", { created: 2, failed: 1 })).toBe(
      "Khương Văn Đường đã nhập đối tác từ Excel: 2 thành công, 1 lỗi",
    );
    expect(
      say("create_contract", { contractNumber: "HD-001", partnerName: "Công ty A" }),
    ).toBe('Khương Văn Đường đã thêm hợp đồng “HD-001” với đối tác “Công ty A”');
    expect(say("update_contract", { contractNumber: "HD-001" })).toBe(
      'Khương Văn Đường đã sửa hợp đồng “HD-001”',
    );
    expect(say("archive_contract", { contractNumber: "HD-001" })).toBe(
      'Khương Văn Đường đã lưu trữ hợp đồng “HD-001”',
    );
    expect(say("upload_file", { filename: "hop-dong.pdf", size: 878 })).toBe(
      'Khương Văn Đường đã tải tệp lên “hop-dong.pdf” (878 B)',
    );
    expect(say("update_profile", { changed: ["fullName"] })).toBe(
      "Khương Văn Đường đã cập nhật hồ sơ",
    );
    expect(say("create_user", { fullName: "Nguyễn Văn A" })).toBe(
      'Khương Văn Đường đã thêm người dùng “Nguyễn Văn A”',
    );
    expect(say("update_user_role", { from: "user", to: "admin" })).toBe(
      'Khương Văn Đường đã đổi vai trò thành “admin”',
    );
    expect(say("set_active_user", { to: true })).toBe(
      "Khương Văn Đường đã bật người dùng",
    );
    expect(say("set_active_user", { to: false })).toBe(
      "Khương Văn Đường đã vô hiệu hoá người dùng",
    );
    expect(say("delete_user", { fullName: "Nguyễn Văn A" })).toBe(
      'Khương Văn Đường đã xoá người dùng “Nguyễn Văn A”',
    );
    expect(say("export_logs", { format: "xlsx", count: 5 })).toBe(
      "Khương Văn Đường đã xuất nhật ký",
    );
  });

  it("uses a neutral subject when the actor name is missing", () => {
    expect(say("create_partner", { name: "Công ty A" }, null)).toBe(
      'Một người dùng đã thêm đối tác “Công ty A”',
    );
  });

  it("drops a missing field without breaking the sentence", () => {
    expect(say("create_partner", {})).toBe("Khương Văn Đường đã thêm đối tác");
    expect(say("create_contract", {})).toBe("Khương Văn Đường đã thêm hợp đồng");
    expect(say("update_user_role", {})).toBe("Khương Văn Đường đã đổi vai trò");
    expect(say("upload_file", { size: 1229 })).toBe(
      "Khương Văn Đường đã tải tệp lên (1,2 KB)",
    );
  });

  it("formats byte sizes with a Vietnamese decimal comma", () => {
    expect(say("upload_file", { filename: "a.pdf", size: 878 })).toBe(
      'Khương Văn Đường đã tải tệp lên “a.pdf” (878 B)',
    );
    expect(say("upload_file", { filename: "a.pdf", size: 1229 })).toBe(
      'Khương Văn Đường đã tải tệp lên “a.pdf” (1,2 KB)',
    );
    expect(say("upload_file", { filename: "a.pdf", size: 2048 })).toBe(
      'Khương Văn Đường đã tải tệp lên “a.pdf” (2 KB)',
    );
  });

  it("falls back for an unknown action without dumping raw JSON", () => {
    const out = say("delete_everything" as AuditAction, {});
    expect(out).toContain("đã thực hiện");
    expect(out).not.toContain("{");
  });
});
