import { describe, expect, it } from "vitest";

import {
  BLANK_VALUE,
  uniqueOptions,
  uniqueOptionsFlattened,
} from "@/components/partners/hooks/use-partner-table-filters";

describe("uniqueOptions helper", () => {
  it("counts distinct non-empty values and sorts them alphabetically (vi)", () => {
    const values = ["Hà Nội", "Đà Nẵng", "Hà Nội", "TP. Hồ Chí Minh", "An Giang"];
    const options = uniqueOptions(values);

    expect(options).toEqual([
      { value: "An Giang", count: 1 },
      { value: "Đà Nẵng", count: 1 },
      { value: "Hà Nội", count: 2 },
      { value: "TP. Hồ Chí Minh", count: 1 },
    ]);
  });

  it("handles blanks when includeBlanks is true", () => {
    const values = ["Hà Nội", null, "", undefined, "Hà Nội"];
    const options = uniqueOptions(values, true);

    expect(options).toEqual([
      { value: "Hà Nội", count: 2 },
      { value: BLANK_VALUE, label: "(Trống / Chưa có)", count: 3 },
    ]);
  });

  it("does not append BLANK_VALUE when includeBlanks is false", () => {
    const values = ["Hà Nội", null, "Đà Nẵng"];
    const options = uniqueOptions(values, false);

    expect(options).toEqual([
      { value: "Đà Nẵng", count: 1 },
      { value: "Hà Nội", count: 1 },
    ]);
  });

  it("flattens arrays and aggregates options correctly", () => {
    const values = [["HRP", "HR_VN"], ["HRP"], null, ["HRP_GLOBAL"]];
    const options = uniqueOptionsFlattened(values);

    expect(options).toEqual([
      { value: "HR_VN", count: 1 },
      { value: "HRP", count: 2 },
      { value: "HRP_GLOBAL", count: 1 },
    ]);
  });
});
