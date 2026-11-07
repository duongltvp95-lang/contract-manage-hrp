import { describe, expect, it } from "vitest";

import { sanitizeInternalRedirectPath } from "@/lib/auth-redirect";

describe("sanitizeInternalRedirectPath (A09)", () => {
  it("falls back to /dashboard when next is missing or empty", () => {
    expect(sanitizeInternalRedirectPath(null)).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath(undefined)).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("")).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("   ")).toBe("/dashboard");
  });

  it("blocks external URLs, protocol-relative URLs, backslashes, and encoded variants", () => {
    const attacks = [
      "https://evil.example/phish",
      "http://evil.example",
      "javascript:alert(1)",
      "//evil.example/path",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/%2f/evil.example",
      "/%2f%2fevil.example",
      "/%252f%252fevil.example",
      "/%5cevil.example",
      "/dashboard\r\nLocation: https://evil.example",
      "/dashboard/../evil",
      "/dashboard/%2e%2e/evil",
    ];

    for (const payload of attacks) {
      expect(sanitizeInternalRedirectPath(payload), payload).toBe("/dashboard");
    }
  });

  it("blocks unallowed internal prefixes such as API routes or arbitrary paths", () => {
    expect(sanitizeInternalRedirectPath("/api/admin/logs/export")).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("/unknown-route")).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("/dashboard-evil")).toBe("/dashboard");
  });

  it("preserves allowed internal routes along with query strings and hashes", () => {
    expect(sanitizeInternalRedirectPath("/")).toBe("/");
    expect(sanitizeInternalRedirectPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("/auth/update-password")).toBe("/auth/update-password");
    expect(sanitizeInternalRedirectPath("/contracts/abc-123?scope=active#files")).toBe(
      "/contracts/abc-123?scope=active#files",
    );
    expect(sanitizeInternalRedirectPath("/partners?q=Thien+Quang&page=2")).toBe(
      "/partners?q=Thien+Quang&page=2",
    );
    expect(sanitizeInternalRedirectPath("/settings")).toBe("/settings");
    expect(sanitizeInternalRedirectPath("/admin/logs")).toBe("/admin/logs");
  });
});
