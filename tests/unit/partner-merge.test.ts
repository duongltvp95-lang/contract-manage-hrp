import { describe, expect, it } from "vitest";

import {
  buildMergePatch,
  matchExistingPartner,
  type MergeablePartner,
  type MergeIncoming,
} from "@/lib/partner-merge";

/**
 * Round 25, part 1 — the pure merge rule.
 */

function partner(overrides: Partial<MergeablePartner> = {}): MergeablePartner {
  return {
    id: "p1",
    name: "Công ty TNHH Đăng Khoa",
    tax_code: "0312345678",
    abbreviation: "DK",
    region: "Miền Bắc",
    address: "Bắc Ninh",
    status: "active",
    companies: ["HRP"],
    ...overrides,
  };
}

function incoming(overrides: Partial<MergeIncoming> = {}): MergeIncoming {
  return {
    name: "Công ty TNHH Đăng Khoa",
    taxCode: "0312345678",
    abbreviation: "DK",
    region: "Miền Bắc",
    address: "Bắc Ninh",
    status: "active",
    companies: ["HRP"],
    hasCompanyColumn: true,
    ...overrides,
  };
}

describe("matchExistingPartner", () => {
  it("prefers the tax code over the name", () => {
    const byName = partner({ id: "a", tax_code: null, name: "Công ty TNHH Đăng Khoa" });
    const byTax = partner({ id: "b", name: "Tên hoàn toàn khác" });

    const match = matchExistingPartner([byName, byTax], incoming());
    expect(match?.id).toBe("b");
  });

  it("matches by abbreviation (diacritics-folded)", () => {
    const p = partner({ tax_code: null, name: "Tên khác", abbreviation: "ĐK" });
    const match = matchExistingPartner(
      [p],
      incoming({ taxCode: "", name: "Tên khác nữa", abbreviation: "dk" }),
    );
    expect(match?.id).toBe("p1");
  });

  it("matches by name (diacritics-folded)", () => {
    const p = partner({ tax_code: null, abbreviation: null, name: "Công ty TNHH Đăng Khoa" });
    const match = matchExistingPartner(
      [p],
      incoming({ taxCode: "", abbreviation: "", name: "cong ty tnhh dang khoa" }),
    );
    expect(match?.id).toBe("p1");
  });

  it("matches by address (diacritics-folded)", () => {
    const p = partner({
      tax_code: null,
      abbreviation: null,
      name: "Tên khác",
      address: "Bắc Ninh",
    });
    const match = matchExistingPartner(
      [p],
      incoming({ taxCode: "", abbreviation: "", name: "Tên khác nữa", address: "bac ninh" }),
    );
    expect(match?.id).toBe("p1");
  });

  it("matches by region only when the four stronger keys all fail", () => {
    const p = partner({
      tax_code: null,
      abbreviation: null,
      name: "Tên khác",
      address: "Hà Nội",
      region: "Miền Bắc",
    });
    const match = matchExistingPartner(
      [p],
      incoming({
        taxCode: "",
        abbreviation: "",
        name: "Tên khác nữa",
        address: "Hồ Chí Minh",
        region: "mien bac",
      }),
    );
    expect(match?.id).toBe("p1");
  });

  it("skips a key whose incoming value is empty", () => {
    const p = partner({ abbreviation: null });
    // Empty abbreviation must not match p's null abbreviation via the
    // abbreviation key — and nothing else matches.
    const match = matchExistingPartner(
      [p],
      incoming({ abbreviation: "", name: "Tên khác", taxCode: "", address: "", region: "" }),
    );
    expect(match).toBeNull();
  });

  it("company overlap: no shared company → create new, never overwrite", () => {
    const p = partner({ companies: ["HRP"] });
    const match = matchExistingPartner([p], incoming({ companies: ["HR VN"] }));
    expect(match).toBeNull();
  });

  it("company overlap: a shared company → match proceeds", () => {
    const p = partner({ companies: ["HRP", "HR VN"] });
    const match = matchExistingPartner([p], incoming({ companies: ["HR VN"] }));
    expect(match?.id).toBe("p1");
  });

  it("without the Công ty column the whole directory is considered", () => {
    const p = partner({ companies: ["HRP"] });
    const match = matchExistingPartner(
      [p],
      incoming({ companies: ["HR VN"], hasCompanyColumn: false }),
    );
    expect(match?.id).toBe("p1");
  });
});

describe("buildMergePatch", () => {
  it("fills missing fields and overwrites differing ones", () => {
    const existing = partner({ address: null, abbreviation: null, region: null });
    const { patch, changed } = buildMergePatch(existing, incoming({ status: "stopped" }));

    expect(patch).toEqual({
      address: "Bắc Ninh",
      abbreviation: "DK",
      region: "Miền Bắc",
      status: "stopped",
    });
    expect(changed.sort()).toEqual(["abbreviation", "address", "region", "status"]);
  });

  it("keeps existing values when the incoming field is empty", () => {
    const existing = partner();
    const { patch } = buildMergePatch(
      existing,
      incoming({ address: "", abbreviation: "", region: "", status: null }),
    );

    expect(patch).toEqual({});
  });

  it("unions companies when the file has the Công ty column", () => {
    const existing = partner({ companies: ["HRP"] });
    const { patch, changed, companiesToAdd } = buildMergePatch(
      existing,
      incoming({ companies: ["HRP", "HR VN"] }),
    );

    expect(companiesToAdd).toEqual(["HR VN"]);
    expect(changed).toContain("companies");
    expect(patch).toEqual({});
  });

  it("does not touch companies when the column is absent", () => {
    const existing = partner({ companies: ["HRP"] });
    const { companiesToAdd, changed } = buildMergePatch(
      existing,
      incoming({ companies: ["HR VN"], hasCompanyColumn: false }),
    );

    expect(companiesToAdd).toEqual([]);
    expect(changed).not.toContain("companies");
  });
});
