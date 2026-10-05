import { describe, expect, it } from "vitest";

import {
  filterPartners,
  isLegacyPartnerText,
  NO_PARTNER,
  partnerDisplayName,
} from "@/lib/partner-display";

/**
 * Feature round 2, part 2 — the partner display and search rules.
 *
 * Pure helpers, so the rules the contracts list, the contract detail panel and
 * the form's combobox all rely on can be checked without a database or a browser.
 */

describe("partnerDisplayName", () => {
  it("prefers the linked partner's name", () => {
    expect(
      partnerDisplayName({ partner_name: "Công ty ABC", partner_text: "abc cũ" }),
    ).toBe("Công ty ABC");
  });

  it("falls back to the free text for a contract that predates the directory", () => {
    expect(
      partnerDisplayName({ partner_name: null, partner_text: "Công ty TNHH Samsung" }),
    ).toBe("Công ty TNHH Samsung");
  });

  it("uses the fallback when the linked name is blank", () => {
    expect(
      partnerDisplayName({ partner_name: "   ", partner_text: "Vẫn còn chữ này" }),
    ).toBe("Vẫn còn chữ này");
  });

  it("trims what it returns", () => {
    expect(partnerDisplayName({ partner_text: "  Có khoảng trắng  " })).toBe(
      "Có khoảng trắng",
    );
  });

  it("shows a dash when there is nothing to show", () => {
    expect(partnerDisplayName({})).toBe(NO_PARTNER);
    expect(partnerDisplayName({ partner_name: null, partner_text: null })).toBe(
      NO_PARTNER,
    );
    expect(partnerDisplayName({ partner_text: "   " })).toBe(NO_PARTNER);
  });
});

describe("isLegacyPartnerText", () => {
  it("is true only for free text with no link", () => {
    expect(isLegacyPartnerText({ partner_text: "Công ty cũ" })).toBe(true);
  });

  it("is false once a partner is linked", () => {
    expect(
      isLegacyPartnerText({ partner_name: "Công ty ABC", partner_text: "Công ty cũ" }),
    ).toBe(false);
  });

  it("is false when there is no text at all", () => {
    expect(isLegacyPartnerText({})).toBe(false);
    expect(isLegacyPartnerText({ partner_text: "  " })).toBe(false);
  });
});

describe("filterPartners", () => {
  const partners = [
    { id: "1", name: "Công ty TNHH Samsung Electronics Việt Nam" },
    { id: "2", name: "Công ty Cổ phần Bưu chính Viettel" },
    { id: "3", name: "Đối tác Nhật Bản" },
  ];

  it("returns everything for an empty term", () => {
    expect(filterPartners(partners, "")).toHaveLength(3);
    expect(filterPartners(partners, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively", () => {
    expect(filterPartners(partners, "samsung").map((p) => p.id)).toEqual(["1"]);
  });

  it("matches unaccented input against accented names", () => {
    // A Vietnamese user typing on a phone keyboard types "doi tac", not "Đối tác".
    expect(filterPartners(partners, "doi tac").map((p) => p.id)).toEqual(["3"]);
  });

  it("matches across a middle segment, not only a prefix", () => {
    expect(filterPartners(partners, "viettel").map((p) => p.id)).toEqual(["2"]);
  });

  it("ignores diacritics in the query as well", () => {
    expect(filterPartners(partners, "Nhật").map((p) => p.id)).toEqual(["3"]);
  });

  it("returns nothing when there is no match", () => {
    expect(filterPartners(partners, "không tồn tại")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const copy = [...partners];
    filterPartners(partners, "samsung");
    expect(partners).toEqual(copy);
  });
});
