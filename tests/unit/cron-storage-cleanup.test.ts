import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/cron/storage-cleanup/route";
import * as authModule from "@/lib/auth";
import * as storageCleanupModule from "@/lib/services/storage-cleanup";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/services/storage-cleanup", () => ({
  processR2CleanupQueue: vi.fn(),
}));

describe("Route /api/cron/storage-cleanup", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, CRON_SECRET: "test-secret-123" };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("từ chối 401 khi không có Authorization header và không có phiên đăng nhập", async () => {
    vi.mocked(authModule.getCurrentUser).mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/cron/storage-cleanup");
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(storageCleanupModule.processR2CleanupQueue).not.toHaveBeenCalled();
  });

  it("từ chối 401 khi Authorization Bearer token không khớp", async () => {
    vi.mocked(authModule.getCurrentUser).mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/cron/storage-cleanup", {
      headers: {
        authorization: "Bearer wrong-secret",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(storageCleanupModule.processR2CleanupQueue).not.toHaveBeenCalled();
  });

  it("chấp nhận và thực thi khi có Authorization Bearer CRON_SECRET hợp lệ", async () => {
    vi.mocked(authModule.getCurrentUser).mockResolvedValue(null);
    vi.mocked(storageCleanupModule.processR2CleanupQueue).mockResolvedValue({
      processed: 5,
      succeeded: 4,
      failed: 1,
    });

    const req = new NextRequest("http://localhost:3000/api/cron/storage-cleanup?limit=25", {
      headers: {
        authorization: "Bearer test-secret-123",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.processed).toBe(5);
    expect(body.succeeded).toBe(4);
    expect(body.failed).toBe(1);
    expect(storageCleanupModule.processR2CleanupQueue).toHaveBeenCalledWith({
      limit: 25,
      maxAttempts: 5,
    });
  });

  it("chấp nhận và thực thi khi phiên đăng nhập là admin", async () => {
    vi.mocked(authModule.getCurrentUser).mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
      organizationId: "org-1",
      fullName: "Admin User",
      accentColor: null,
      backgroundColor: null,
      sidebarColor: null,
    });

    vi.mocked(storageCleanupModule.processR2CleanupQueue).mockResolvedValue({
      processed: 0,
      succeeded: 0,
      failed: 0,
    });

    const req = new NextRequest("http://localhost:3000/api/cron/storage-cleanup");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(storageCleanupModule.processR2CleanupQueue).toHaveBeenCalled();
  });

  it("từ chối 401 khi người dùng đăng nhập không phải admin và không có secret", async () => {
    vi.mocked(authModule.getCurrentUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "user",
      organizationId: "org-1",
      fullName: "Standard User",
      accentColor: null,
      backgroundColor: null,
      sidebarColor: null,
    });

    const req = new NextRequest("http://localhost:3000/api/cron/storage-cleanup");
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(storageCleanupModule.processR2CleanupQueue).not.toHaveBeenCalled();
  });
});
