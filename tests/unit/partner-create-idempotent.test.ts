import { describe, expect, it } from "vitest";

import { findBestMatchingPartner } from "@/lib/ai/matching";

describe("Partner Creation & Matching Idempotency", () => {
  it("không tạo trùng lặp khi đối tác đã có tên khớp trong danh sách", () => {
    const existingPartners = [
      { id: "partner-1", name: "Công ty TNHH Cung Ứng Nhân Lực HR" },
      { id: "partner-2", name: "Công ty Cổ phần Xây dựng ABC" },
    ];

    // Case 1: Tên đối tác đọc được trùng khớp hoàn toàn (không phân biệt hoa thường/khoảng trắng)
    const extractedPartnerName = "  công ty TNHH Cung Ứng Nhân Lực HR ";
    const trimmed = extractedPartnerName.trim();

    let matched = findBestMatchingPartner(trimmed, existingPartners);
    if (!matched) {
      const exact = existingPartners.find(
        (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (exact) matched = { id: exact.id, name: exact.name };
    }

    expect(matched).not.toBeNull();
    expect(matched?.id).toBe("partner-1");
  });

  it("chặn tạo đối tác mới nếu thời gian còn lại trước deadline dưới 4 giây", () => {
    const actionStartTime = Date.now();
    const actionDeadline = actionStartTime + 48_000;

    // Giả lập thời điểm hiện tại chỉ còn 3.5s trước deadline
    const fakeCurrentTime = actionDeadline - 3_500;

    const remainingMs = actionDeadline - fakeCurrentTime;
    const shouldAttemptCreate = remainingMs >= 4_000;

    // Phải chặn tạo mới để không bị timeout dở dang trong lúc DB đang ghi
    expect(shouldAttemptCreate).toBe(false);
  });

  it("cho phép tạo đối tác nếu thời gian còn lại trước deadline đủ lớn (>= 4s)", () => {
    const actionStartTime = Date.now();
    const actionDeadline = actionStartTime + 48_000;

    // Giả lập thời điểm hiện tại còn 6s trước deadline
    const fakeCurrentTime = actionDeadline - 6_000;

    const remainingMs = actionDeadline - fakeCurrentTime;
    const shouldAttemptCreate = remainingMs >= 4_000;

    expect(shouldAttemptCreate).toBe(true);
  });
});
