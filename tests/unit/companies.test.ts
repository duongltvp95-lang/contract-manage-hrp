import { describe, expect, it } from "vitest";
import {
  getInternalCompanyName,
  HRP_COMPANY_ID,
  HR_VN_COMPANY_ID,
  INTERNAL_COMPANY_IDS,
  INTERNAL_COMPANY_NAMES,
  isInternalCompanyId,
} from "@/lib/companies";

describe("Internal Companies Utility", () => {
  it("defines standard IDs for HRP and HR VN", () => {
    expect(HRP_COMPANY_ID).toBe("00000000-0000-4000-8000-000000000001");
    expect(HR_VN_COMPANY_ID).toBe("00000000-0000-4000-8000-000000000002");
    expect(INTERNAL_COMPANY_IDS).toContain(HRP_COMPANY_ID);
    expect(INTERNAL_COMPANY_IDS).toContain(HR_VN_COMPANY_ID);
    expect(INTERNAL_COMPANY_NAMES[HRP_COMPANY_ID]).toBe("HRP");
    expect(INTERNAL_COMPANY_NAMES[HR_VN_COMPANY_ID]).toBe("HR VN");
  });

  it("identifies internal company IDs correctly", () => {
    expect(isInternalCompanyId(HRP_COMPANY_ID)).toBe(true);
    expect(isInternalCompanyId(HR_VN_COMPANY_ID)).toBe(true);
    expect(isInternalCompanyId("other-id")).toBe(false);
    expect(isInternalCompanyId(null)).toBe(false);
    expect(isInternalCompanyId(undefined)).toBe(false);
    expect(isInternalCompanyId("")).toBe(false);
  });

  it("retrieves the internal company name", () => {
    expect(getInternalCompanyName(HRP_COMPANY_ID)).toBe("HRP");
    expect(getInternalCompanyName(HR_VN_COMPANY_ID)).toBe("HR VN");
    expect(getInternalCompanyName("unknown-id")).toBeUndefined();
    expect(getInternalCompanyName(null)).toBeUndefined();
    expect(getInternalCompanyName(undefined)).toBeUndefined();
  });
});
