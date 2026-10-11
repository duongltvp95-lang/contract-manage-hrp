import { describe, expect, it } from "vitest";

import {
  catalogErr,
  dynamicCatalogErr,
  getErrorMessage,
  STATIC_ERROR_CATALOG,
  DYNAMIC_ERROR_BUILDERS,
  type StaticAppErrorCode,
} from "@/lib/errors/catalog";
import { dbError, statusForCode } from "@/lib/services/types";

describe("error catalog (Task #5)", () => {
  it("defines non-empty message and valid ServiceErrorCode for every static error", () => {
    const validCodes = new Set([
      "unauthenticated",
      "forbidden",
      "not_found",
      "validation",
      "upload_incomplete",
      "db_error",
    ]);

    for (const [key, item] of Object.entries(STATIC_ERROR_CATALOG)) {
      expect(validCodes.has(item.code), `${key} has valid code`).toBe(true);
      expect(typeof item.message).toBe("string");
      expect(item.message.trim().length, `${key} message non-empty`).toBeGreaterThan(0);
    }
  });

  it("getErrorMessage retrieves the exact Vietnamese message for static keys", () => {
    expect(getErrorMessage("NOT_FOUND_CONTRACT")).toBe("Không tìm thấy hợp đồng");
    expect(getErrorMessage("NOT_FOUND_PARTNER")).toBe("Không tìm thấy đối tác");
    expect(getErrorMessage("AUTH_REQUIRED")).toBe("Bạn cần đăng nhập để thực hiện thao tác này");
    expect(getErrorMessage("DB_ERROR")).toBe("Không xử lý được yêu cầu. Vui lòng thử lại sau ít phút.");
  });

  it("catalogErr creates a properly structured ServiceErr object", () => {
    const key: StaticAppErrorCode = "FORBIDDEN_DELETE_SELF";
    const result = catalogErr(key);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("forbidden");
    expect(result.appCode).toBe("FORBIDDEN_DELETE_SELF");
    expect(result.message).toBe("Bạn không thể xoá chính mình");
    expect(result.issues).toBeUndefined();
  });

  it("catalogErr supports optional validation issues", () => {
    const issues = [{ path: "tax_code", message: "Mã số thuế không hợp lệ" }];
    const result = catalogErr("VALIDATION_GENERIC", issues);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("validation");
    expect(result.issues).toEqual(issues);
  });

  it("dynamicCatalogErr formats templated error messages correctly", () => {
    expect(typeof DYNAMIC_ERROR_BUILDERS.VALIDATION_EMAIL_EXISTS).toBe("function");

    const emailErr = dynamicCatalogErr("VALIDATION_EMAIL_EXISTS", ["test@hrpartner.vn"]);
    expect(emailErr.ok).toBe(false);
    expect(emailErr.code).toBe("validation");
    expect(emailErr.appCode).toBe("VALIDATION_EMAIL_EXISTS");
    expect(emailErr.message).toBe("Email test@hrpartner.vn đã tồn tại trong hệ thống");

    const contractErr = dynamicCatalogErr("VALIDATION_PARTNER_HAS_CONTRACTS", [5]);
    expect(contractErr.message).toBe(
      "Đối tác đang có 5 hợp đồng, không thể xoá — hãy xoá hợp đồng trước",
    );

    const taxCodeErr = dynamicCatalogErr("VALIDATION_TAX_CODE_EXISTS", ["0101234567"]);
    expect(taxCodeErr.message).toBe("Mã số thuế 0101234567 đã tồn tại cho đối tác khác");

    const bulkLimitErr = dynamicCatalogErr("VALIDATION_BULK_DELETE_LIMIT", [100]);
    expect(bulkLimitErr.message).toBe("Chỉ được xoá tối đa 100 mục mỗi lần");
  });

  it("dbError delegates safely to DB_ERROR catalog entry without leaking details", () => {
    const fakeDriverError = new Error("syntax error at or near 'SELECT'");
    const result = dbError("testScope", fakeDriverError);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("db_error");
    expect(result.appCode).toBe("DB_ERROR");
    expect(result.message).toBe(STATIC_ERROR_CATALOG.DB_ERROR.message);
    expect(result.message).not.toContain("syntax error");
  });

  it("statusForCode maps all service error codes to standard HTTP status codes", () => {
    expect(statusForCode("unauthenticated")).toBe(401);
    expect(statusForCode("forbidden")).toBe(403);
    expect(statusForCode("not_found")).toBe(404);
    expect(statusForCode("validation")).toBe(422);
    expect(statusForCode("db_error")).toBe(500);
    expect(statusForCode("upload_incomplete")).toBe(500);
  });
});
