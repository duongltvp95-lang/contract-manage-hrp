import { describe, expect, it } from "vitest";

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_TARGET_KINDS,
  AUDIT_TARGET_KIND_LABELS,
  LogsFilterSchema,
} from "@schemas/audit-log";

/**
 * Round 3, part 1 + round 8, part 1 — shared filter / enum schemas.
 *
 * The page and the export endpoint both read the same shape. The list of
 * actions is the single source of truth for the UI label, the action
 * argType, the database CHECK, and the test fixtures.
 */

describe("audit-log enums", () => {
  it("lists every action with a Vietnamese label", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
  });

  it("declares every target kind the round 8 migration knows about", () => {
    expect(AUDIT_TARGET_KINDS).toEqual([
      "user",
      "logs",
      "partner",
      "contract",
      "file",
      "profile",
    ]);
  });

  it("labels every target kind", () => {
    for (const kind of AUDIT_TARGET_KINDS) {
      expect(AUDIT_TARGET_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("labels the round 8 business actions in Vietnamese", () => {
    expect(AUDIT_ACTION_LABELS.create_partner).toBe("Tạo đối tác");
    expect(AUDIT_ACTION_LABELS.import_partners).toBe("Nhập đối tác từ Excel");
    expect(AUDIT_ACTION_LABELS.create_contract).toBe("Tạo hợp đồng");
    expect(AUDIT_ACTION_LABELS.archive_contract).toBe("Lưu trữ hợp đồng");
    expect(AUDIT_ACTION_LABELS.upload_file).toBe("Tải tệp lên");
    expect(AUDIT_ACTION_LABELS.update_profile).toBe("Cập nhật hồ sơ");
  });
});

describe("LogsFilterSchema", () => {
  it("applies defaults when the query string is empty", () => {
    const parsed = LogsFilterSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(50);
  });

  it("coerces numeric page and pageSize from strings", () => {
    const parsed = LogsFilterSchema.parse({ page: "3", pageSize: "100" });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(100);
  });

  it("rejects a pageSize above the cap", () => {
    expect(LogsFilterSchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });

  it("rejects a page below 1", () => {
    expect(LogsFilterSchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(
      LogsFilterSchema.safeParse({ action: "delete_everything" }).success,
    ).toBe(false);
  });

  it("accepts every round 8 business action as a filter value", () => {
    for (const action of [
      "create_partner",
      "update_partner",
      "import_partners",
      "create_contract",
      "update_contract",
      "archive_contract",
      "upload_file",
      "update_profile",
    ]) {
      expect(LogsFilterSchema.parse({ action }).action).toBe(action);
    }
  });

  it("accepts a valid actorId uuid", () => {
    const parsed = LogsFilterSchema.parse({
      actorId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.actorId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects a malformed actorId", () => {
    expect(LogsFilterSchema.safeParse({ actorId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("accepts ISO datetimes for from and to", () => {
    const parsed = LogsFilterSchema.parse({
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-31T23:59:59Z",
    });
    expect(parsed.from).toBe("2026-10-01T00:00:00Z");
    expect(parsed.to).toBe("2026-10-31T23:59:59Z");
  });
});
