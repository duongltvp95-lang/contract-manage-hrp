import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUERY,
  contractsHref,
  hasActiveFilters,
  parseContractsQuery,
  resolveExpiryPreset,
  sanitizeSearchTerm,
} from "@/lib/contracts-query";

/**
 * W1-WEB-020/021/022 — list state (plan sections 50-53, 69, 70).
 *
 * The list is a pure function of its URL, so these tests cover the whole
 * search/filter/sort/pagination contract without a database.
 */

describe("parseContractsQuery", () => {
  it("returns defaults for an empty query string", () => {
    expect(parseContractsQuery({})).toEqual(DEFAULT_QUERY);
  });

  it("reads the documented parameters", () => {
    const parsed = parseContractsQuery({
      q: "samsung",
      preset: "expiring90",
      signedFrom: "2026-01-01",
      signedTo: "2026-06-30",
      expiryFrom: "2026-07-01",
      expiryTo: "2026-12-31",
      page: "3",
      pageSize: "50",
      sort: "expiry_date",
      dir: "asc",
    });

    expect(parsed).toMatchObject({
      q: "samsung",
      preset: "expiring90",
      signedFrom: "2026-01-01",
      signedTo: "2026-06-30",
      expiryFrom: "2026-07-01",
      expiryTo: "2026-12-31",
      page: 3,
      pageSize: 50,
      sort: "expiry_date",
      dir: "asc",
    });
  });

  it("falls back safely on anything unrecognised", () => {
    const parsed = parseContractsQuery({
      preset: "; drop table contracts",
      page: "-4",
      pageSize: "9999",
      sort: "notes",
      dir: "sideways",
      signedFrom: "2026-02-30",
    });

    expect(parsed.preset).toBe("");
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(DEFAULT_QUERY.pageSize);
    expect(parsed.sort).toBe(DEFAULT_QUERY.sort);
    expect(parsed.dir).toBe(DEFAULT_QUERY.dir);
    // 30 February is not a real date, so the filter is dropped rather than sent.
    expect(parsed.signedFrom).toBe("");
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseContractsQuery({ q: ["first", "second"] }).q).toBe("first");
  });

  it("truncates an over-long search term", () => {
    expect(parseContractsQuery({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("contractsHref", () => {
  it("omits everything still at its default", () => {
    expect(contractsHref({}, DEFAULT_QUERY)).toBe("/contracts");
  });

  it("serialises only what changed", () => {
    expect(contractsHref({ q: "samsung", page: 2 }, DEFAULT_QUERY)).toBe(
      "/contracts?q=samsung&page=2",
    );
  });

  it("carries the existing state forward while patching one field", () => {
    const current = parseContractsQuery({ q: "samsung", page: "3" });
    const href = contractsHref({ page: 1 }, current);
    expect(href).toContain("q=samsung");
    expect(href).not.toContain("page=");
  });

  it("encodes a term that would otherwise break the URL", () => {
    expect(contractsHref({ q: "a&b=c" }, DEFAULT_QUERY)).toContain("q=a%26b%3Dc");
  });
});

describe("hasActiveFilters", () => {
  it("is false only for a pristine query", () => {
    expect(hasActiveFilters(DEFAULT_QUERY)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_QUERY, page: 5 })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_QUERY, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_QUERY, preset: "expired" })).toBe(true);
  });
});

describe("resolveExpiryPreset (plan sections 69, 70)", () => {
  const today = new Date(2026, 9, 3); // 3 October 2026, local time

  it("expired means strictly before today", () => {
    expect(resolveExpiryPreset("expired", today)).toEqual({ lt: "2026-10-03" });
  });

  it("expiring30 is an inclusive today..today+30 window", () => {
    expect(resolveExpiryPreset("expiring30", today)).toEqual({
      gte: "2026-10-03",
      lte: "2026-11-02",
    });
  });

  it("expiring90 is an inclusive today..today+90 window", () => {
    expect(resolveExpiryPreset("expiring90", today)).toEqual({
      gte: "2026-10-03",
      lte: "2027-01-01",
    });
  });

  it("crosses a month and a year boundary correctly", () => {
    expect(resolveExpiryPreset("expiring90", new Date(2026, 11, 20))).toEqual({
      gte: "2026-12-20",
      lte: "2027-03-20",
    });
  });

  it("is the same rule the dashboard uses", () => {
    // lib/services/dashboard.ts calls resolveExpiryPreset with "expiring90" and
    // "expired"; if this changes, the dashboard card and the list filter drift.
    const soon = resolveExpiryPreset("expiring90", today);
    expect(soon.gte).toBe("2026-10-03");
    expect(soon.lte).toBe("2027-01-01");
  });
});

describe("sanitizeSearchTerm (plan section 51)", () => {
  it("strips the characters that carry meaning inside a PostgREST or=() filter", () => {
    expect(sanitizeSearchTerm("a,b(c)d\"e\\f")).toBe("a b c d e f");
  });

  it("keeps LIKE wildcards, which users expect to work", () => {
    expect(sanitizeSearchTerm("50%_off")).toBe("50%_off");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeSearchTerm("  samsung   electronics  ")).toBe(
      "samsung electronics",
    );
  });

  it("never returns more than 100 characters", () => {
    expect(sanitizeSearchTerm("x".repeat(300))).toHaveLength(100);
  });

  it("neutralises an injection attempt", () => {
    const term = sanitizeSearchTerm("x,organization_id.neq.11111111-1111-1111-1111-111111111111");
    expect(term).not.toContain(",");
    expect(term).not.toContain("(");
    expect(term).not.toContain(")");
  });
});
